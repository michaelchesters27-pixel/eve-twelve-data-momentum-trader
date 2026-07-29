from pathlib import Path
import re, sys
root=Path(__file__).resolve().parents[1]
ea=root/'mt5/EVE_Twelve_Data_Fixed_Ladder_v2.40.mq5'
required=[ea,root/'railway/src/server.js',root/'railway/src/config.js',root/'railway/src/twelve-data.js',root/'railway/public/index.html',root/'railway/public/app.js',root/'railway/package.json',root/'README.md',root/'DEPLOY-THIS-FIRST.txt']
errors=[]
for f in required:
    if not f.exists(): errors.append(f'Missing required file: {f.relative_to(root)}')
text=ea.read_text(encoding='utf-8') if ea.exists() else ''
required_ea=[
 '#property version   "2.40"','2907202622','EVEL240','FIXED_LADDER_FLIGHT_RECORDER',
 'InpLevelsPerSide                  = 8','InpGridSpacingPrice               = 3.000','InpFixedFallbackPrice             = 2.000',
 'InpFixedLot                       = 0.01','InpBreakEvenTriggerPrice          = 1.500','InpBreakEvenBufferPrice           = 0.150',
 'InpProfitTargetEnabledAtStart','runtime_profit_target_enabled','runtime_profit_target_money',
 'InpDailyLossEnabledAtStart','runtime_daily_loss_enabled','runtime_daily_loss_money','daily_loss_reset_at_ms','DailyLossRemaining()',
 'ArmFreshTwoSidedBracket','trade.BuyStop(','trade.SellStop(','RegisterBullet(','UpdateBulletMetrics(',
 'ManageIndividualProtection(','BE_ACTIVATED','NEWEST BULLET FAILED BEFORE HALFWAY','BE PROTECTED STOP - BULLET ONLY',
 'CAMPAIGN PROFIT TARGET','UNIQUE_POSITION_IDENTIFIER','eventSequence','campaignBuyBulletsFired','INITIAL STOP LOSS','BE PROTECTED STOP','MaybeQueueReplaySnapshot','QueueLadderReport','/api/ea/replay','/api/ea/ladder','/api/ea/bullet-protection',
 '/api/ea/heartbeat','/api/ea/basket','/api/ea/leg','/api/ea/order','/api/ea/bank','EntryBlockReason()'
]
for item in required_ea:
    if item not in text: errors.append(f'Missing EA element: {item}')
for forbidden in ['NEWEST BULLET BE STOP - CLOSE FULL CAMPAIGN','#property version   "1.04"','EVETD104','TWELVE_DATA_CONFIRMED_BREAKOUT_TRADER','NO_CONFIRMED_BUY_BREAKOUT','NO_CONFIRMED_SELL_BREAKOUT','BUY_QUALITY_','SELL_QUALITY_','CancelPendingSide(OppositeSide(campaign_side)']:
    if forbidden in text: errors.append(f'Stale or forbidden element: {forbidden}')
# EntryBlockReason can only use hard operating/capital checks.
m=re.search(r'string\s+EntryBlockReason\s*\(\s*\)\s*\{(?P<body>.*?)\n\}',text,re.S)
if not m: errors.append('Could not inspect EntryBlockReason')
else:
    body=m.group('body').lower()
    for bad in ['momentum.','buyscore','sellscore','quality','breakout','m15','h1','session']:
        if bad in body: errors.append(f'Entry block still uses conservative filter: {bad}')
# Inputs referenced must be declared.
declared=set(re.findall(r'^\s*input\s+(?:bool|int|long|ulong|double|string|datetime)\s+(Inp\w+)',text,re.M))
refs=set(re.findall(r'\b(Inp\w+)\b',text))
for name in sorted(refs-declared): errors.append(f'Undefined input reference: {name}')
# Duplicate function definitions.
funcs=re.findall(r'^\s*(?:bool|void|int|long|ulong|double|string|datetime|MomentumSnapshot)\s+(\w+)\s*\(',text,re.M)
for name in sorted(set(funcs)):
    if funcs.count(name)>1: errors.append(f'Duplicate function: {name}')
# Lexical balance ignoring strings/comments.
def balanced(code):
    stack=[]; state='code'; i=0; pairs={')':'(',']':'[','}':'{'}
    while i<len(code):
        c=code[i]; n=code[i+1] if i+1<len(code) else ''
        if state=='code':
            if c=='/' and n=='/': state='line'; i+=2; continue
            if c=='/' and n=='*': state='block'; i+=2; continue
            if c=='"': state='str'; i+=1; continue
            if c in '([{': stack.append(c)
            elif c in ')]}':
                if not stack or stack.pop()!=pairs[c]: return False,f'mismatch at {i}'
        elif state=='line':
            if c=='\n': state='code'
        elif state=='block':
            if c=='*' and n=='/': state='code'; i+=2; continue
        elif state=='str':
            if c=='\\': i+=2; continue
            if c=='"': state='code'
        i+=1
    return (not stack and state in ('code','line')),f'stack={stack[-5:]} state={state}'
ok,msg=balanced(text)
if not ok: errors.append(f'EA lexical balance failed: {msg}')
# StringFormat argument count for literal format strings.
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
    args.append(body[start:].strip()); return args
for sm in re.finditer(r'\bStringFormat\s*\(',text):
    op=text.find('(',sm.start()); cl=matching_paren(text,op)
    if cl<0: errors.append(f'Unclosed StringFormat line {text.count(chr(10),0,sm.start())+1}'); continue
    args=split_args(text[op+1:cl])
    if not args or not args[0].lstrip().startswith('"'): continue
    specs=re.findall(r'%(?!%)(?:[-+0 #]*\d*(?:\.\d+)?(?:I64)?[diuoxXfFeEgGcs])',args[0])
    if len(specs)!=len(args)-1:
        errors.append(f'StringFormat line {text.count(chr(10),0,sm.start())+1}: {len(specs)} formats but {len(args)-1} values')
server=(root/'railway/src/server.js').read_text() if (root/'railway/src/server.js').exists() else ''
cfg=(root/'railway/src/config.js').read_text() if (root/'railway/src/config.js').exists() else ''
ui=(root/'railway/public/index.html').read_text()+(root/'railway/public/app.js').read_text()
for item in ['FIXED 8×8 LADDER FLIGHT RECORDER','profitTargetEnabled','dailyLossEnabled','/api/daily-loss/reset','/api/settings','/api/replay/','ladders','replay','protections','eve-fixed-ladder-${collection}.csv','auditCampaign','campaignTimeline']:
    if item not in server+ui: errors.append(f'Missing Railway/UI element: {item}')
for item in ["version: '2.4.0'","mode: 'FIXED_LADDER_FLIGHT_RECORDER_DEMO'","BULLET_DATA_NAMESPACE || 'v220'"]:
    if item not in cfg: errors.append(f'Missing v2.40 config: {item}')
if errors:
    print('\n'.join('ERROR: '+e for e in errors)); sys.exit(1)
print('Project source validation passed.')
