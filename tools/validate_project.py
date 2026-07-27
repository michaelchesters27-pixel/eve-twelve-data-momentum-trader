from pathlib import Path
import re, sys
root=Path(__file__).resolve().parents[1]
ea=root/'mt5/EVE_Twelve_Data_Momentum_Trader_v1.00.mq5'
server=root/'railway/src/server.js'
config=root/'railway/src/config.js'
text=ea.read_text(encoding='utf-8')
errors=[]
required=[
 '#property version   "1.00"','2807202601','EVETD100','PlaceInitialScout','remote_decision_quality',
 'TWELVE_DATA_CONTEXT_SCOUT_SENTINEL_TRADER','InpUseFirstLegFailureExit','InpCloseBasketOnNewestLegSL',
 'InpUseBasketProfitLock','trade.Buy(','trade.Sell(','trade.BuyStop(','trade.SellStop(',
 '/api/ea/heartbeat','/api/ea/basket','/api/ea/leg','/api/ea/order','/api/ea/bank'
]
for item in required:
    if item not in text: errors.append(f'Missing EA element: {item}')
for forbidden in ['EVE421','2707202643','version":"4.21']:
    if forbidden in text: errors.append(f'Stale EA identity: {forbidden}')
js=server.read_text(encoding='utf-8')
for item in ['TwelveDataClient','chooseAssessment','/api/ea/control','api\\/export','calculatePerformance','scans','signals','baskets']:
    if item not in js: errors.append(f'Missing Railway element: {item}')
for forbidden in ['SUPABASE_','DATABASE_URL','postgres']:
    if forbidden.lower() in (js+config.read_text()).lower(): errors.append(f'Unexpected database dependency: {forbidden}')

# Balanced braces outside strings and comments.
def balanced(code):
    stack=[]; i=0; state='code'
    pairs={'}':'{',')':'(',']':'['}
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

# StringFormat argument count check.
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
        c=body[i]; n=body[i+1] if i+1<len(body) else ''
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

for m in re.finditer(r'\bStringFormat\s*\(',text):
    openpos=text.find('(',m.start()); close=matching_paren(text,openpos)
    if close<0: errors.append(f'Unclosed StringFormat line {text.count(chr(10),0,m.start())+1}'); continue
    args=split_args(text[openpos+1:close])
    if not args or not args[0].lstrip().startswith('"'): continue
    fmt=args[0]
    specs=re.findall(r'%(?!%)(?:[-+0 #]*\d*(?:\.\d+)?(?:I64)?[diuoxXfFeEgGcs])',fmt)
    if len(specs)!=len(args)-1:
        line=text.count('\n',0,m.start())+1
        errors.append(f'StringFormat line {line}: {len(specs)} formats but {len(args)-1} values')

if errors:
    print('\n'.join(f'ERROR: {e}' for e in errors)); sys.exit(1)
print('Project source validation passed.')
