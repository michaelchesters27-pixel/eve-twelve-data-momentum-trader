from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
ea = root / 'mt5/EVE_Twelve_Data_Bullet_Storm_v2.00.mq5'
server = root / 'railway/src/server.js'
config = root / 'railway/src/config.js'
tdfile = root / 'railway/src/twelve-data.js'
package = root / 'railway/package.json'
errors = []

for file in [ea, server, config, tdfile, package, root/'README.md', root/'DEPLOY-THIS-FIRST.txt']:
    if not file.exists(): errors.append(f'Missing required file: {file.relative_to(root)}')

text = ea.read_text(encoding='utf-8') if ea.exists() else ''
required_ea = [
    '#property version   "2.00"', '2807202620', 'EVEB200',
    'AGGRESSIVE_TWO_SIDED_BULLET_ENGINE', 'ArmFreshTwoSidedBracket',
    'PlaceBulletStop', 'EnsureCampaignPendings', 'ProcessReversalFlip',
    'InpLockDirectionAfterSameSideLeg', 'direction_locked', 'direction_leg_count',
    'campaign_fallback_distance', 'campaign_bullet_spacing', 'NewestFallbackReached',
    'NEWEST BULLET BROKER SL - CLOSE FULL CAMPAIGN',
    'HARD BASKET LOSS LIMIT', 'DailyLossBlocked', 'InpMaximumPositions',
    'InpMaximumTotalLots', 'InpEmergencyBasketLossMoney', 'InpMaximumDailyLossMoney',
    'trade.BuyStop(', 'trade.SellStop(', 'trade.PositionClose(',
    '/api/ea/heartbeat', '/api/ea/scan', '/api/ea/signal', '/api/ea/basket',
    '/api/ea/leg', '/api/ea/order', '/api/ea/bank',
    'TWO-SIDED BRACKET FIRES WITHOUT QUALITY FILTER',
    'bool armed = ArmFreshTwoSidedBracket', 'immediate_rearm_pending = !armed',
]
for item in required_ea:
    if item not in text: errors.append(f'Missing EA element: {item}')

for forbidden in [
    '#property version   "1.04"', 'EVETD104', '2807202604',
    'TWELVE_DATA_CONFIRMED_BREAKOUT_TRADER', 'remote_decision_quality',
    'NO_CONFIRMED_BUY_BREAKOUT', 'NO_CONFIRMED_SELL_BREAKOUT'
]:
    if forbidden in text: errors.append(f'Stale conservative EA element: {forbidden}')

# Confirm NewEntriesAllowed only contains hard operating/risk checks, not momentum/quality permission.
match = re.search(r'bool\s+NewEntriesAllowed\s*\(\s*\)\s*\{(?P<body>.*?)\n\}', text, re.S)
if not match:
    errors.append('Could not inspect NewEntriesAllowed')
else:
    body = match.group('body')
    for forbidden in ['momentum.', 'buyScore', 'sellScore', 'quality', 'M15', 'H1', 'breakout']:
        if forbidden.lower() in body.lower(): errors.append(f'Entry permission still uses conservative filter: {forbidden}')

# Inputs referenced must be declared.
declared = set(re.findall(r'\binput\s+(?:group\s+"[^"]*"|(?:\w+\s+)?(Inp\w+))', text))
declared.discard('')
refs = set(re.findall(r'\b(Inp\w+)\b', text))
for name in sorted(refs - declared): errors.append(f'Undefined input reference: {name}')

# No duplicate function definitions.
funcs = re.findall(r'^\s*(?:bool|void|int|long|ulong|double|string|datetime|MomentumSnapshot)\s+(\w+)\s*\(', text, re.M)
for name in sorted({x for x in funcs if funcs.count(x) > 1}): errors.append(f'Duplicate function definition: {name}')

# Balanced braces/parentheses outside comments and strings.
def balanced(code):
    stack=[]; i=0; state='code'; pairs={'}':'{',')':'(',']':'['}
    while i<len(code):
        c=code[i]; n=code[i+1] if i+1<len(code) else ''
        if state=='code':
            if c=='/' and n=='/': state='line'; i+=2; continue
            if c=='/' and n=='*': state='block'; i+=2; continue
            if c=='"': state='str'; i+=1; continue
            if c in '({[': stack.append(c)
            elif c in ')}]':
                if not stack or stack.pop()!=pairs[c]: return False, f'mismatch at {i}'
        elif state=='line':
            if c=='\n': state='code'
        elif state=='block':
            if c=='*' and n=='/': state='code'; i+=2; continue
        elif state=='str':
            if c=='\\': i+=2; continue
            if c=='"': state='code'
        i+=1
    return not stack and state in ('code','line'), f'stack={stack[-5:]} state={state}'

ok,msg=balanced(text)
if not ok: errors.append(f'EA lexical balance failed: {msg}')

# StringFormat placeholder/argument count.
def matching_paren(code,start):
    depth=0; state='code'; i=start
    while i<len(code):
        c=code[i]; n=code[i+1] if i+1<len(code) else ''
        if state=='code':
            if c=='"': state='str'
            elif c=='/' and n=='/': state='line'; i+=1
            elif c=='/' and n=='*': state='block'; i+=1
            elif c=='(': depth+=1
            elif c==')':
                depth-=1
                if depth==0: return i
        elif state=='str':
            if c=='\\': i+=1
            elif c=='"': state='code'
        elif state=='line':
            if c=='\n': state='code'
        elif state=='block':
            if c=='*' and n=='/': state='code'; i+=1
        i+=1
    return -1

def split_args(body):
    args=[]; start=0; depth=0; state='code'; i=0
    while i<len(body):
        c=body[i]
        if state=='code':
            if c=='"': state='str'
            elif c in '([{': depth+=1
            elif c in ')]}': depth-=1
            elif c==',' and depth==0: args.append(body[start:i].strip()); start=i+1
        elif state=='str':
            if c=='\\': i+=1
            elif c=='"': state='code'
        i+=1
    args.append(body[start:].strip())
    return args

for m in re.finditer(r'\bStringFormat\s*\(', text):
    openpos=text.find('(',m.start()); close=matching_paren(text,openpos)
    if close<0:
        errors.append(f'Unclosed StringFormat line {text.count(chr(10),0,m.start())+1}')
        continue
    args=split_args(text[openpos+1:close])
    if not args or not args[0].lstrip().startswith('"'): continue
    specs=re.findall(r'%(?!%)(?:[-+0 #]*\d*(?:\.\d+)?(?:I64)?[diuoxXfFeEgGcs])',args[0])
    if len(specs)!=len(args)-1:
        line=text.count('\n',0,m.start())+1
        errors.append(f'StringFormat line {line}: {len(specs)} formats but {len(args)-1} values')

js = server.read_text(encoding='utf-8') if server.exists() else ''
cfg = config.read_text(encoding='utf-8') if config.exists() else ''
td = tdfile.read_text(encoding='utf-8') if tdfile.exists() else ''
required_server = [
    'EVE Bullet Storm Trader', 'AGGRESSIVE TWO-SIDED BULLET ENGINE',
    "signal: 'signals'", '/api/ea/control', '/api/ea/heartbeat',
    '/api/ea/${route}', 'eve-bullet-storm-${collection}.csv',
    'MT5 TWO-SIDED BULLET ENGINE CONTROLS ENTRIES',
    'Twelve Data is telemetry only. MT5 bullet geometry controls entries.'
]
all_server = js + cfg + td
for item in required_server:
    if item not in all_server: errors.append(f'Missing Railway element: {item}')
for item in ["version: '2.0.0'", "mode: 'AGGRESSIVE_TWO_SIDED_BULLET_ENGINE_DEMO'", "BULLET_DATA_NAMESPACE || 'v200'"]:
    if item not in cfg: errors.append(f'Missing v2 config: {item}')
for forbidden in ['chooseAssessment', "from './decision.js'", 'INITIAL_QUALITY_MIN']:
    if forbidden in js: errors.append(f'Old decision engine still active in server: {forbidden}')
if (root/'railway/src/decision.js').exists(): errors.append('Old decision.js must not be shipped')

for item in ['WebSocket', 'TWELVE_DATA_WS', 'receivedAt = Date.now()', 'startRestPolling', 'closedValues']:
    if item not in td: errors.append(f'Missing Twelve Data element: {item}')

if errors:
    print('\n'.join(f'ERROR: {e}' for e in errors))
    sys.exit(1)
print('Project source validation passed.')
