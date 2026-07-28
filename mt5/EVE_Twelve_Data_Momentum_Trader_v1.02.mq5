#property copyright "EVE Momentum"
#property version   "1.02"
#property strict
#property description "Autonomous XAUUSD trader: Twelve Data intelligence on Railway with MT5 scout execution, continuation ladder, sentinel and basket protection."

#include <Trade/Trade.mqh>

CTrade trade;

input group "Identity"
input string InpTradeSymbol                    = "XAUUSD";
input ulong  InpMagicNumber                    = 2807202602;
input string InpOrderCommentPrefix             = "EVETD102";

input group "Position sizing and capital protection"
input double InpFixedLot                       = 0.01;
input int    InpMaximumPositions               = 4;
input double InpMaximumTotalLots               = 0.04;
input double InpEmergencyBasketLossPercent     = 1.50;
input double InpMaximumDailyLossPercent        = 4.00;
input int    InpMaximumSpreadPoints            = 120;
input int    InpSlippagePoints                 = 30;

input group "Momentum detector"
input int    InpATRPeriod                      = 14;
input int    InpSignalScoreRequired            = 5;
input int    InpSignalScoreDifference          = 2;
input double InpVelocity1ATR                   = 0.040;
input double InpVelocity3ATR                   = 0.070;
input double InpVelocity10ATR                  = 0.100;
input double InpTickExpansion                  = 1.10;
input double InpAcceleration                   = 1.05;
input int    InpSignalHoldMilliseconds         = 400;
input int    InpOppositeSignalHoldMilliseconds = 1000;
input double InpOppositeThresholdMultiplier    = 1.15;
input int    InpMicroBreakLookbackMilliseconds = 1800;

input group "Twelve Data decision engine"
input double InpInitialQualityRequired          = 80.0;
input double InpContinuationQualityRequired     = 88.0;
input double InpOppositeQualityForBank          = 82.0;
input int    InpDecisionMaximumAgeSeconds       = 15;
input bool   InpRequireLocalBrokerMomentumForAdd= true;
input bool   InpRequireScoutProfitBeforeAdd      = true;
input double InpScoutProfitBeforeAddATR          = 0.10;

input group "Campaign construction"
input double InpEntrySpacingATR                = 0.18;
input double InpMinimumEntrySpacingPrice       = 0.25;
input double InpStopLossATR                    = 1.05;
input double InpTakeProfitATR                  = 1.30;
input int    InpMaximumCampaignEntries         = 4;
input double InpAddSupportVelocity1ATR         = 0.020;
input double InpAddSupportVelocity3ATR         = 0.035;
input int    InpAddSignalScoreRequired         = 5;
input int    InpAddScoreDifference             = 2;
input double InpMinimumAddMomentumRetention    = 0.70;
input double InpHardFadeVelocityATR            = 0.030;
input int    InpPendingCancelRetryMilliseconds = 750;

input group "Basket protection and banking"
input bool   InpUseFirstLegFailureExit         = true;
input double InpFirstLegFailureATR             = 0.25;
input bool   InpCloseBasketOnNewestLegSL       = true;
input bool   InpUseBasketProfitLock            = true;
input double InpBasketLockMinimumMoney         = 0.30;
input double InpBasketLockTriggerRiskFraction  = 0.30;
input double InpBasketLockRetainPercent        = 40.0;
input double InpCommissionReservePer001Lot     = 0.08;
input bool   InpBankPositiveOnHardFade         = true;
input int    InpScanLogSeconds                 = 2;

input group "Individual position protection"
input bool   InpUseBreakEven                   = true;
input double InpBreakEvenTriggerATR            = 0.40;
input double InpBreakEvenBufferATR             = 0.05;
input bool   InpUseTrailingStop                = true;
input double InpTrailingActivationATR          = 0.65;
input double InpTrailingDistanceATR            = 0.30;
input double InpMinimumTrailStepATR            = 0.06;

input group "Fresh-burst reset"
input double InpQuietVelocity1ATR              = 0.020;
input double InpQuietVelocity3ATR              = 0.035;
input int    InpQuietResetMilliseconds         = 1200;

input group "Railway connection"
input string InpRailwayBaseUrl                 = "https://YOUR-SERVICE.up.railway.app";
input string InpBotToken                       = "CHANGE-ME";
input int    InpHeartbeatSeconds               = 2;
input int    InpCommandPollSeconds             = 1;
input int    InpWebTimeoutMilliseconds         = 3500;

input group "Operation"
input bool   InpStartAutonomous                = true;
input bool   InpShowPanel                      = true;

#define TICK_BUFFER_SIZE 1024
#define MODIFY_MEMORY_SIZE 128

struct TickSample
{
   ulong  ms;
   double mid;
};

struct MomentumSnapshot
{
   bool   ready;
   double atr;
   double mid;
   double velocity1;
   double velocity3;
   double velocity10;
   double tickRatio;
   double acceleration;
   double bodyATR;
   double microHigh;
   double microLow;
   int    buyScore;
   int    sellScore;
   string direction;
   string reason;
};

enum EngineState
{
   STATE_WARMING = 0,
   STATE_IDLE,
   STATE_ARMED,
   STATE_RUNNING,
   STATE_CANCELLING,
   STATE_PAUSED,
   STATE_EMERGENCY
};

string trade_symbol = "";
int atr_handle = INVALID_HANDLE;
TickSample tick_buffer[TICK_BUFFER_SIZE];
int tick_head = 0;
int tick_count = 0;

MomentumSnapshot momentum;
EngineState engine_state = STATE_WARMING;
string campaign_side = "NONE";
string last_campaign_side = "NONE";
string held_signal_side = "NONE";
ulong held_signal_started_ms = 0;
bool reset_required = false;
ulong quiet_started_ms = 0;
bool adding_stopped = false;
int campaign_entries = 0;
datetime campaign_started_at = 0;
double campaign_start_balance = 0.0;
double campaign_peak_floating = 0.0;
double campaign_worst_floating = 0.0;
string campaign_exit_reason = "CAMPAIGN COMPLETE";
bool basket_close_requested = false;
string basket_close_reason = "";
int basket_close_attempts = 0;
ulong newest_position_id = 0;
ulong newest_ticket = 0;
datetime newest_leg_open_time = 0;
double newest_leg_current_profit = 0.0;
double newest_leg_peak_profit = 0.0;
bool newest_leg_sl_exit_detected = false;
double first_leg_entry_price = 0.0;
double first_leg_entry_atr = 0.0;
ulong first_leg_position_id = 0;
double last_fill_velocity_abs = 0.0;
int last_fill_same_score = 0;
int last_fill_opposite_score = 0;
string last_event = "EA starting";

string remote_decision_id = "";
string remote_decision_action = "WAIT";
string remote_decision_direction = "NONE";
double remote_decision_quality = 0.0;
double remote_buy_quality = 0.0;
double remote_sell_quality = 0.0;
bool remote_add_allowed = false;
long remote_decision_valid_until = 0;
long remote_decision_ttl_remaining_ms = 0;
ulong remote_decision_received_ms = 0;
ulong remote_decision_local_valid_until_ms = 0;
string remote_decision_reason = "WAITING FOR TWELVE DATA";
string remote_decision_regime = "UNKNOWN";
string remote_decision_m5 = "UNKNOWN";
string remote_decision_m15 = "UNKNOWN";
string remote_decision_h1 = "UNKNOWN";
string consumed_decision_id = "";
string pending_decision_id = "";

bool local_paused = false;
bool remote_autonomous = true;
bool emergency_stopped = false;
long last_command_id = 0;
string last_command_result = "No command received";

ulong last_trade_request_ms = 0;
ulong last_cancel_request_ms = 0;
ulong last_heartbeat_ms = 0;
ulong last_poll_ms = 0;
ulong next_http_allowed_ms = 0;
int http_failure_count = 0;
string last_http_status = "Not connected";
string queued_basket_json = "";
#define TELEMETRY_QUEUE_SIZE 128
string telemetry_endpoints[TELEMETRY_QUEUE_SIZE];
string telemetry_payloads[TELEMETRY_QUEUE_SIZE];
int telemetry_head = 0;
int telemetry_tail = 0;
int telemetry_count = 0;
ulong last_scan_log_ms = 0;
double cached_atr = 0.0;
ulong cached_atr_ms = 0;
double cached_daily_pnl = 0.0;
ulong cached_daily_pnl_ms = 0;
double runtime_fixed_lot = 0.01;
bool runtime_use_equity_scaling = false;
double runtime_equity_per_001 = 1000.0;
int runtime_settings_version = 0;

ulong modified_tickets[MODIFY_MEMORY_SIZE];
ulong modified_times[MODIFY_MEMORY_SIZE];
int modified_count = 0;

string PANEL_PREFIX = "EVETD102_";

int OnInit()
{
   trade_symbol = InpTradeSymbol == "" ? _Symbol : InpTradeSymbol;
   if(!SymbolSelect(trade_symbol, true))
   {
      Print("EVE TD v1.02 cannot select symbol ", trade_symbol);
      return INIT_FAILED;
   }

   long margin_mode = AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   if(margin_mode != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
   {
      Alert("EVE TD v1.02 requires a HEDGING demo account.");
      return INIT_FAILED;
   }

   atr_handle = iATR(trade_symbol, PERIOD_M1, MathMax(2, InpATRPeriod));
   if(atr_handle == INVALID_HANDLE)
   {
      Print("EVE TD v1.02 failed to create ATR handle. Error ", GetLastError());
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpSlippagePoints);
   trade.SetTypeFillingBySymbol(trade_symbol);
   trade.SetMarginMode();

   remote_autonomous = InpStartAutonomous;
   runtime_fixed_lot = InpFixedLot;
   EventSetTimer(1);
   if(InpShowPanel) CreatePanel();
   last_event = "v1.02 ready: Twelve Data decision engine with MT5 protected execution";
   Print(last_event);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(atr_handle != INVALID_HANDLE) IndicatorRelease(atr_handle);
   DeletePanel();
}

void OnTick()
{
   MqlTick tick;
   if(!SymbolInfoTick(trade_symbol, tick)) return;
   RecordTick(tick);
   BuildMomentum(tick, momentum);
   UpdateNewestLegStats();
   ManageIndividualProtection(tick);
   ManageBasketProtection(tick);
   EnforceCapitalProtection();
   RunEngine(tick);
   if(InpShowPanel) UpdatePanel();
}

void OnTimer()
{
   MaybeQueueScanReport();
   ProcessRailway();
   if(InpShowPanel) UpdatePanel();
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD || trans.deal == 0) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if(HistoryDealGetString(trans.deal, DEAL_SYMBOL) != trade_symbol) return;
   if((ulong)HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != InpMagicNumber) return;

   ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   ENUM_DEAL_TYPE type = (ENUM_DEAL_TYPE)HistoryDealGetInteger(trans.deal, DEAL_TYPE);
   ENUM_DEAL_REASON reason = (ENUM_DEAL_REASON)HistoryDealGetInteger(trans.deal, DEAL_REASON);
   ulong position_id = (ulong)HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   double price = HistoryDealGetDouble(trans.deal, DEAL_PRICE);
   double volume = HistoryDealGetDouble(trans.deal, DEAL_VOLUME);

   if(entry == DEAL_ENTRY_IN || entry == DEAL_ENTRY_INOUT)
   {
      string side = type == DEAL_TYPE_BUY ? "BUY" : "SELL";
      bool first_entry = campaign_started_at <= 0;
      if(first_entry) StartCampaign(side);
      campaign_entries++;
      engine_state = STATE_RUNNING;
      if(first_entry) adding_stopped = false;

      if(campaign_entries == 1)
      {
         first_leg_entry_price = price;
         first_leg_entry_atr = momentum.atr > 0.0 ? momentum.atr : CurrentATR();
         first_leg_position_id = position_id;
      }

      newest_position_id = position_id;
      newest_ticket = trans.position;
      newest_leg_open_time = TimeCurrent();
      newest_leg_current_profit = 0.0;
      newest_leg_peak_profit = 0.0;
      last_fill_velocity_abs = MathAbs(momentum.velocity1);
      last_fill_same_score = side == "BUY" ? momentum.buyScore : momentum.sellScore;
      last_fill_opposite_score = side == "BUY" ? momentum.sellScore : momentum.buyScore;

      QueueLegReport("OPEN", side, trans.position, position_id, volume, price, 0.0, campaign_entries == 1 ? "TWELVE DATA SCOUT FILL" : "TWELVE DATA CONTINUATION FILL");
      if(campaign_entries == 1)
         last_event = StringFormat("%s first position opened at %.2f; first leg must validate the burst", side, price);
      else
         last_event = StringFormat("%s position %d opened at %.2f; newest leg is now basket sentinel", side, campaign_entries, price);
   }
   else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
   {
      string position_side = type == DEAL_TYPE_SELL ? "BUY" : "SELL";
      double profit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT) +
                      HistoryDealGetDouble(trans.deal, DEAL_COMMISSION) +
                      HistoryDealGetDouble(trans.deal, DEAL_SWAP) +
                      HistoryDealGetDouble(trans.deal, DEAL_FEE);
      string close_reason = DealReasonText(reason);
      QueueLegReport("CLOSE", position_side, trans.position, position_id, volume, price, profit, close_reason);

      if(InpCloseBasketOnNewestLegSL && position_id > 0 && position_id == newest_position_id && reason == DEAL_REASON_SL)
      {
         newest_leg_sl_exit_detected = true;
         last_event = StringFormat("Newest %s leg hit broker SL at %.2f; banking remaining basket", position_side, price);
      }
      else
      {
         last_event = StringFormat("%s position closed %.2f by %s", position_side, profit, close_reason);
      }
   }
}

void OnChartEvent(const int id,const long &lparam,const double &dparam,const string &sparam)
{
   if(id != CHARTEVENT_OBJECT_CLICK) return;
   if(sparam == PANEL_PREFIX + "PAUSE")
   {
      local_paused = !local_paused;
      if(local_paused) CancelAllPending("manual pause");
      last_event = local_paused ? "EA paused; open positions remain protected" : "EA resumed";
   }
   else if(sparam == PANEL_PREFIX + "CLOSE")
   {
      RequestBasketClose("MANUAL CLOSE");
   }
   else if(sparam == PANEL_PREFIX + "STOP")
   {
      emergency_stopped = true;
      local_paused = true;
      RequestBasketClose("EMERGENCY STOP");
      last_event = "EMERGENCY STOP active";
   }
}

void RecordTick(const MqlTick &tick)
{
   tick_buffer[tick_head].ms = GetTickCount64();
   tick_buffer[tick_head].mid = (tick.bid + tick.ask) * 0.5;
   tick_head = (tick_head + 1) % TICK_BUFFER_SIZE;
   if(tick_count < TICK_BUFFER_SIZE) tick_count++;
}

int BufferIndexFromNewest(int offset)
{
   int index = tick_head - 1 - offset;
   while(index < 0) index += TICK_BUFFER_SIZE;
   return index % TICK_BUFFER_SIZE;
}

bool PriceAtAge(ulong age_ms, double &price)
{
   if(tick_count < 2) return false;
   ulong target = GetTickCount64() > age_ms ? GetTickCount64() - age_ms : 0;
   for(int offset=0; offset<tick_count; offset++)
   {
      int index = BufferIndexFromNewest(offset);
      if(tick_buffer[index].ms <= target)
      {
         price = tick_buffer[index].mid;
         return true;
      }
   }
   return false;
}

int CountTicksSince(ulong age_ms)
{
   ulong target = GetTickCount64() > age_ms ? GetTickCount64() - age_ms : 0;
   int count = 0;
   for(int offset=0; offset<tick_count; offset++)
   {
      int index = BufferIndexFromNewest(offset);
      if(tick_buffer[index].ms < target) break;
      count++;
   }
   return count;
}

bool MicroRange(int lookback_ms, double &high, double &low)
{
   if(tick_count < 5) return false;
   ulong now = GetTickCount64();
   ulong target = now > (ulong)lookback_ms ? now - (ulong)lookback_ms : 0;
   high = -1.0e100;
   low = 1.0e100;
   int used = 0;
   for(int offset=1; offset<tick_count; offset++)
   {
      int index = BufferIndexFromNewest(offset);
      if(tick_buffer[index].ms < target) break;
      high = MathMax(high, tick_buffer[index].mid);
      low = MathMin(low, tick_buffer[index].mid);
      used++;
   }
   return used >= 3;
}

double CurrentATR()
{
   ulong now = GetTickCount64();
   if(cached_atr > 0.0 && cached_atr_ms > 0 && now - cached_atr_ms < 250) return cached_atr;
   if(atr_handle == INVALID_HANDLE) return cached_atr;
   double buffer[2];
   int copied = CopyBuffer(atr_handle, 0, 0, 2, buffer);
   if(copied < 1) return cached_atr;
   double value = copied > 1 && buffer[1] > 0.0 ? buffer[1] : buffer[0];
   if(value > 0.0)
   {
      cached_atr = value;
      cached_atr_ms = now;
   }
   return cached_atr;
}

void BuildMomentum(const MqlTick &tick, MomentumSnapshot &out)
{
   out.ready = false;
   out.atr = CurrentATR();
   out.mid = (tick.bid + tick.ask) * 0.5;
   out.buyScore = 0;
   out.sellScore = 0;
   out.direction = "NONE";
   out.reason = "warming";
   if(out.atr <= 0.0 || tick_count < 20) return;

   double p1, p3, p10;
   if(!PriceAtAge(1000, p1) || !PriceAtAge(3000, p3) || !PriceAtAge(10000, p10)) return;
   if(!MicroRange(InpMicroBreakLookbackMilliseconds, out.microHigh, out.microLow)) return;

   out.velocity1 = (out.mid - p1) / out.atr;
   out.velocity3 = (out.mid - p3) / out.atr;
   out.velocity10 = (out.mid - p10) / out.atr;
   int ticks1 = CountTicksSince(1000);
   int ticks10 = CountTicksSince(10000);
   double normal_per_second = MathMax(1.0, (double)ticks10 / 10.0);
   out.tickRatio = (double)ticks1 / normal_per_second;
   double baseline = MathMax(0.004, MathAbs(out.velocity3) / 3.0);
   out.acceleration = MathAbs(out.velocity1) / baseline;
   double open = iOpen(trade_symbol, PERIOD_M1, 0);
   out.bodyATR = open > 0.0 ? (out.mid - open) / out.atr : 0.0;

   if(out.velocity1 >= InpVelocity1ATR) out.buyScore++;
   if(out.velocity3 >= InpVelocity3ATR) out.buyScore++;
   if(out.velocity10 >= InpVelocity10ATR) out.buyScore++;
   if(out.tickRatio >= InpTickExpansion) out.buyScore++;
   if(out.acceleration >= InpAcceleration && out.velocity1 > 0.0) out.buyScore++;
   if(out.mid >= out.microHigh) out.buyScore++;
   if(out.bodyATR >= 0.08) out.buyScore++;

   if(out.velocity1 <= -InpVelocity1ATR) out.sellScore++;
   if(out.velocity3 <= -InpVelocity3ATR) out.sellScore++;
   if(out.velocity10 <= -InpVelocity10ATR) out.sellScore++;
   if(out.tickRatio >= InpTickExpansion) out.sellScore++;
   if(out.acceleration >= InpAcceleration && out.velocity1 < 0.0) out.sellScore++;
   if(out.mid <= out.microLow) out.sellScore++;
   if(out.bodyATR <= -0.08) out.sellScore++;

   if(out.buyScore >= InpSignalScoreRequired && out.buyScore - out.sellScore >= InpSignalScoreDifference)
      out.direction = "BUY";
   else if(out.sellScore >= InpSignalScoreRequired && out.sellScore - out.buyScore >= InpSignalScoreDifference)
      out.direction = "SELL";

   out.reason = StringFormat("BUY %d/7 SELL %d/7 v1 %.3f v3 %.3f ticks x%.2f", out.buyScore, out.sellScore, out.velocity1, out.velocity3, out.tickRatio);
   out.ready = true;
}

bool SpreadOkay()
{
   MqlTick tick;
   if(!SymbolInfoTick(trade_symbol, tick)) return false;
   double point = SymbolInfoDouble(trade_symbol, SYMBOL_POINT);
   if(point <= 0.0) return false;
   double spread_points = (tick.ask - tick.bid) / point;
   return spread_points <= InpMaximumSpreadPoints;
}

double CurrentSpreadPoints()
{
   MqlTick tick;
   if(!SymbolInfoTick(trade_symbol, tick)) return 0.0;
   double point = SymbolInfoDouble(trade_symbol, SYMBOL_POINT);
   return point > 0.0 ? (tick.ask - tick.bid) / point : 0.0;
}

bool NewEntriesAllowed()
{
   if(local_paused || emergency_stopped || !remote_autonomous) return false;
   if(!TerminalInfoInteger(TERMINAL_CONNECTED)) return false;
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)) return false;
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED)) return false;
   if(!SpreadOkay()) return false;
   if(DailyLossBlocked()) return false;
   return true;
}

void RunEngine(const MqlTick &tick)
{
   int positions = CountOurPositions();
   int pending = CountOurPending();

   if(basket_close_requested)
   {
      engine_state = STATE_CANCELLING;
      adding_stopped = true;
      CancelAllPending(basket_close_reason);
      if(positions > 0)
      {
         basket_close_attempts++;
         CloseAllPositions(basket_close_reason);
      }
      if(CountOurPositions() == 0 && CountOurPending() == 0 && campaign_started_at > 0)
         FinishCampaign();
      return;
   }

   if(emergency_stopped)
   {
      engine_state = STATE_EMERGENCY;
      CancelAllPending("emergency state");
      if(positions > 0) RequestBasketClose("EMERGENCY STOP");
      return;
   }
   // A campaign is finished as soon as its final live position is gone. This
   // cleanup runs even while paused or warming, so a stale continuation order
   // can never reopen an already completed campaign.
   if(positions == 0 && campaign_started_at > 0)
   {
      engine_state = STATE_CANCELLING;
      CancelAllPending("campaign flat - remove stale continuation order");
      if(CountOurPending() == 0) FinishCampaign();
      return;
   }

   if(local_paused || !remote_autonomous)
   {
      engine_state = STATE_PAUSED;
      CancelAllPending("paused");
      return;
   }
   if(!momentum.ready)
   {
      engine_state = STATE_WARMING;
      return;
   }

   if(positions > 0 && campaign_side == "NONE") StartCampaign(OurPositionSide());

   if(positions > 0)
   {
      engine_state = STATE_RUNNING;
      UpdateCampaignStats();
      UpdateNewestLegStats();

      string actual_side = OurPositionSide();
      if(actual_side != "NONE") campaign_side = actual_side;

      bool local_hard_fade = campaign_side == "BUY"
         ? (momentum.velocity1 <= -InpHardFadeVelocityATR || momentum.sellScore >= InpSignalScoreRequired)
         : (momentum.velocity1 >= InpHardFadeVelocityATR || momentum.buyScore >= InpSignalScoreRequired);
      bool remote_opposite = RemoteDecisionFresh() && remote_decision_direction != "NONE" &&
                             remote_decision_direction != campaign_side &&
                             remote_decision_quality >= InpOppositeQualityForBank;
      bool hard_fade = local_hard_fade || remote_opposite;

      if(hard_fade)
      {
         adding_stopped = true;
         CancelAllPending("momentum faded or opposite pressure confirmed");
         double floating = BasketFloatingProfit();
         if(InpBankPositiveOnHardFade && floating >= MathMax(0.01, InpBasketLockMinimumMoney))
         {
            RequestBasketClose("POSITIVE BASKET - OPPOSITE MOMENTUM CONFIRMED");
            return;
         }
         last_event = "Momentum faded; existing positions remain protected but no more positions will be added";
      }

      if(!adding_stopped && NewEntriesAllowed() && CampaignCanAdd() && MomentumSupportsCampaign())
         EnsureOnePending(campaign_side);
      else if(!MomentumSupportsCampaign())
         CancelAllPending("same-direction momentum quality no longer supports adding");

      return;
   }

   if(pending > 0)
   {
      engine_state = STATE_ARMED;
      string pending_side = OurPendingSide();
      if(pending_side == "NONE" || !SignalStillSupports(pending_side))
      {
         engine_state = STATE_CANCELLING;
         CancelAllPending("armed signal faded before fill");
      }
      return;
   }

   if(campaign_side != "NONE")
   {
      last_event = campaign_side + " armed signal expired before entry";
      campaign_side = "NONE";
      campaign_entries = 0;
      adding_stopped = false;
   }

   if(reset_required)
   {
      if(QuietResetComplete())
      {
         reset_required = false;
         last_event = "Quiet reset complete; waiting for a genuinely fresh burst";
      }
      else
      {
         engine_state = STATE_IDLE;
         held_signal_side = "NONE";
         held_signal_started_ms = 0;
         return;
      }
   }

   engine_state = STATE_IDLE;
   if(!NewEntriesAllowed()) return;
   string signal = ConfirmedSignal();
   if(signal == "NONE") return;

   campaign_side = signal;
   campaign_entries = 0;
   campaign_started_at = 0;
   adding_stopped = false;
   pending_decision_id = remote_decision_id;
   if(PlaceInitialScout(signal))
   {
      engine_state = STATE_RUNNING;
      consumed_decision_id = pending_decision_id;
      last_event = signal + " Twelve Data decision accepted; scout market position submitted";
   }
   else
   {
      campaign_side = "NONE";
      pending_decision_id = "";
   }
}

bool RemoteDecisionFresh()
{
   if(remote_decision_id == "" || remote_decision_received_ms == 0 || remote_decision_local_valid_until_ms == 0) return false;
   ulong now_ms = GetTickCount64();
   if(now_ms > remote_decision_local_valid_until_ms) return false;
   ulong maximum_age_ms = (ulong)MathMax(1, InpDecisionMaximumAgeSeconds) * 1000;
   if(now_ms - remote_decision_received_ms > maximum_age_ms) return false;
   return true;
}

string ConfirmedSignal()
{
   if(!RemoteDecisionFresh()) return "NONE";
   if(remote_decision_action != "BUY" && remote_decision_action != "SELL") return "NONE";
   if(remote_decision_direction != remote_decision_action) return "NONE";
   if(remote_decision_quality < InpInitialQualityRequired) return "NONE";
   if(remote_decision_id == "" || remote_decision_id == consumed_decision_id) return "NONE";
   pending_decision_id = remote_decision_id;
   return remote_decision_direction;
}

bool SignalStillSupports(string side)
{
   if(!RemoteDecisionFresh()) return false;
   if(remote_decision_direction != side) return false;
   if(remote_decision_action == "WAIT") return false;
   return remote_decision_quality >= MathMax(60.0, InpInitialQualityRequired * 0.82);
}

bool MomentumSupportsCampaign()
{
   if(!RemoteDecisionFresh() || (campaign_side != "BUY" && campaign_side != "SELL")) return false;
   if(remote_decision_direction != campaign_side) return false;
   if(!remote_add_allowed || remote_decision_quality < InpContinuationQualityRequired) return false;

   if(InpRequireLocalBrokerMomentumForAdd)
   {
      if(!momentum.ready) return false;
      double signed_v1 = campaign_side == "BUY" ? momentum.velocity1 : -momentum.velocity1;
      double signed_v3 = campaign_side == "BUY" ? momentum.velocity3 : -momentum.velocity3;
      int same_score = campaign_side == "BUY" ? momentum.buyScore : momentum.sellScore;
      int opposite_score = campaign_side == "BUY" ? momentum.sellScore : momentum.buyScore;
      if(signed_v1 < InpAddSupportVelocity1ATR) return false;
      if(signed_v3 < InpAddSupportVelocity3ATR) return false;
      if(same_score < 4 || same_score - opposite_score < 1) return false;
   }
   return true;
}

bool QuietResetComplete()
{
   bool quiet = MathAbs(momentum.velocity1) <= InpQuietVelocity1ATR &&
                MathAbs(momentum.velocity3) <= InpQuietVelocity3ATR;
   ulong now = GetTickCount64();
   if(!quiet)
   {
      quiet_started_ms = 0;
      return false;
   }
   if(quiet_started_ms == 0) quiet_started_ms = now;
   return now - quiet_started_ms >= (ulong)MathMax(0, InpQuietResetMilliseconds);
}

void StartCampaign(string side)
{
   campaign_side = side;
   campaign_started_at = TimeCurrent();
   campaign_start_balance = AccountInfoDouble(ACCOUNT_BALANCE);
   campaign_peak_floating = BasketFloatingProfit();
   campaign_worst_floating = campaign_peak_floating;
   campaign_exit_reason = "CAMPAIGN COMPLETE";
   basket_close_requested = false;
   basket_close_reason = "";
   basket_close_attempts = 0;
   newest_leg_sl_exit_detected = false;
   first_leg_entry_price = 0.0;
   first_leg_entry_atr = 0.0;
   first_leg_position_id = 0;
   newest_position_id = 0;
   newest_ticket = 0;
   newest_leg_open_time = 0;
   newest_leg_current_profit = 0.0;
   newest_leg_peak_profit = 0.0;
   last_fill_velocity_abs = 0.0;
   last_fill_same_score = 0;
   last_fill_opposite_score = 0;
   adding_stopped = false;
   engine_state = STATE_RUNNING;
}

void UpdateCampaignStats()
{
   double floating = BasketFloatingProfit();
   campaign_peak_floating = MathMax(campaign_peak_floating, floating);
   campaign_worst_floating = MathMin(campaign_worst_floating, floating);
}

void FinishCampaign()
{
   double realised = CampaignRealisedProfit();
   string finished_side = campaign_side;
   if(finished_side == "NONE") finished_side = last_campaign_side;
   last_campaign_side = finished_side;
   QueueBasketReport(finished_side, realised);
   last_event = StringFormat("%s campaign finished %.2f by %s; quiet reset required", finished_side, realised, campaign_exit_reason);
   campaign_side = "NONE";
   campaign_entries = 0;
   campaign_started_at = 0;
   campaign_start_balance = 0.0;
   campaign_peak_floating = 0.0;
   campaign_worst_floating = 0.0;
   campaign_exit_reason = "CAMPAIGN COMPLETE";
   basket_close_requested = false;
   basket_close_reason = "";
   basket_close_attempts = 0;
   newest_leg_sl_exit_detected = false;
   first_leg_entry_price = 0.0;
   first_leg_entry_atr = 0.0;
   first_leg_position_id = 0;
   newest_position_id = 0;
   newest_ticket = 0;
   newest_leg_open_time = 0;
   newest_leg_current_profit = 0.0;
   newest_leg_peak_profit = 0.0;
   last_fill_velocity_abs = 0.0;
   last_fill_same_score = 0;
   last_fill_opposite_score = 0;
   adding_stopped = false;
   reset_required = true;
   quiet_started_ms = 0;
   engine_state = STATE_IDLE;
}

bool PlaceInitialScout(string side)
{
   if(side != "BUY" && side != "SELL") return false;
   ulong now = GetTickCount64();
   if(last_trade_request_ms > 0 && now - last_trade_request_ms < 300) return false;
   last_trade_request_ms = now;

   MqlTick tick;
   if(!SymbolInfoTick(trade_symbol, tick)) return false;
   double atr = MathMax(momentum.atr, CurrentATR());
   if(atr <= 0.0) return false;
   double point = SymbolInfoDouble(trade_symbol, SYMBOL_POINT);
   double min_distance = BrokerMinimumDistancePrice() + point * 2.0;
   double stop_distance = MathMax(atr * InpStopLossATR, min_distance);
   double take_distance = MathMax(atr * InpTakeProfitATR, min_distance);
   double reference = side == "BUY" ? tick.ask : tick.bid;
   double sl = side == "BUY" ? reference - stop_distance : reference + stop_distance;
   double tp = side == "BUY" ? reference + take_distance : reference - take_distance;
   sl = NormalisePrice(sl);
   tp = NormalisePrice(tp);
   double volume = EffectiveLot();
   string comment = StringFormat("%s-%s-01", InpOrderCommentPrefix, side);

   ResetLastError();
   bool submitted = side == "BUY"
      ? trade.Buy(volume, trade_symbol, 0.0, sl, tp, comment)
      : trade.Sell(volume, trade_symbol, 0.0, sl, tp, comment);
   uint code = trade.ResultRetcode();
   bool accepted = submitted && IsAcceptedTradeRetcode(code);
   if(!accepted)
   {
      last_event = StringFormat("%s scout rejected %u: %s", side, code, trade.ResultRetcodeDescription());
      Print("EVE TD v1.02 ", last_event, " MQL=", GetLastError());
      QueueOrderReport("REJECTED", "SCOUT", side == "BUY" ? "MARKET_BUY" : "MARKET_SELL", 0, volume, reference, last_event);
      return false;
   }
   double fill = trade.ResultPrice() > 0.0 ? trade.ResultPrice() : reference;
   QueueOrderReport("PLACED", "SCOUT", side == "BUY" ? "MARKET_BUY" : "MARKET_SELL", trade.ResultOrder(), volume, fill,
                    StringFormat("TD QUALITY %.1f %s", remote_decision_quality, remote_decision_reason));
   return true;
}

bool ScoutHasProvenContinuation()
{
   if(!InpRequireScoutProfitBeforeAdd) return true;
   if(CountOurPositions() != 1) return true;
   if(first_leg_entry_price <= 0.0 || campaign_side == "NONE") return false;

   MqlTick tick;
   if(!SymbolInfoTick(trade_symbol, tick)) return false;
   double atr = first_leg_entry_atr > 0.0 ? first_leg_entry_atr : (momentum.atr > 0.0 ? momentum.atr : CurrentATR());
   if(atr <= 0.0) return false;
   double favourable = campaign_side == "BUY"
      ? tick.bid - first_leg_entry_price
      : first_leg_entry_price - tick.ask;
   return favourable >= atr * MathMax(0.01, InpScoutProfitBeforeAddATR);
}

bool CampaignCanAdd()
{
   int positions = CountOurPositions();
   if(!ScoutHasProvenContinuation()) return false;
   if(positions >= InpMaximumPositions) return false;
   if(campaign_entries >= InpMaximumCampaignEntries) return false;
   double lots = OurTotalLots();
   if(InpMaximumTotalLots > 0.0 && lots + EffectiveLot() > InpMaximumTotalLots + 0.000001) return false;
   return true;
}

bool EnsureOnePending(string side)
{
   if(side != "BUY" && side != "SELL") return false;
   int existing = CountOurPending();
   if(existing > 0)
   {
      if(OurPendingSide() == side) return true;
      CancelAllPending("wrong-side pending removed before arming");
      return false;
   }
   return PlaceContinuationStop(side);
}

bool PlaceContinuationStop(string side)
{
   ulong now = GetTickCount64();
   if(last_trade_request_ms > 0 && now - last_trade_request_ms < 200) return false;
   last_trade_request_ms = now;

   MqlTick tick;
   if(!SymbolInfoTick(trade_symbol, tick)) return false;
   double atr = MathMax(momentum.atr, CurrentATR());
   if(atr <= 0.0) return false;

   double point = SymbolInfoDouble(trade_symbol, SYMBOL_POINT);
   double min_distance = BrokerMinimumDistancePrice() + point * 2.0;
   double spacing = MathMax(InpMinimumEntrySpacingPrice, atr * InpEntrySpacingATR);
   spacing = MathMax(spacing, min_distance);
   double stop_distance = MathMax(atr * InpStopLossATR, min_distance);
   double take_distance = MathMax(atr * InpTakeProfitATR, min_distance);
   double entry = 0.0, sl = 0.0, tp = 0.0;

   if(side == "BUY")
   {
      double highest = HighestOurEntry();
      double base = MathMax(tick.ask, highest);
      entry = MathMax(tick.ask + min_distance, base + spacing);
      sl = entry - stop_distance;
      tp = entry + take_distance;
   }
   else
   {
      double lowest = LowestOurEntry();
      double base = lowest > 0.0 ? MathMin(tick.bid, lowest) : tick.bid;
      entry = MathMin(tick.bid - min_distance, base - spacing);
      sl = entry + stop_distance;
      tp = entry - take_distance;
   }

   entry = NormalisePrice(entry);
   sl = NormalisePrice(sl);
   tp = NormalisePrice(tp);
   double volume = EffectiveLot();
   string comment = StringFormat("%s-%s-%02d", InpOrderCommentPrefix, side, campaign_entries + 1);

   ResetLastError();
   bool submitted = side == "BUY"
      ? trade.BuyStop(volume, entry, trade_symbol, sl, tp, ORDER_TIME_GTC, 0, comment)
      : trade.SellStop(volume, entry, trade_symbol, sl, tp, ORDER_TIME_GTC, 0, comment);
   uint code = trade.ResultRetcode();
   bool accepted = submitted && IsAcceptedTradeRetcode(code);

   if(!accepted)
   {
      last_event = StringFormat("%s stop rejected %u: %s", side, code, trade.ResultRetcodeDescription());
      Print("EVE TD v1.02 ", last_event, " MQL=", GetLastError());
      return false;
   }

   ulong order_ticket = trade.ResultOrder();
   QueueOrderReport("PLACED", "CONTINUATION", side == "BUY" ? "BUY_STOP" : "SELL_STOP", order_ticket, volume, entry, "MOMENTUM QUALITY CONFIRMED");
   last_event = StringFormat("%s STOP %.2f placed with own SL %.2f and TP %.2f", side, entry, sl, tp);
   return true;
}

bool IsAcceptedTradeRetcode(uint code)
{
   return code == TRADE_RETCODE_DONE || code == TRADE_RETCODE_PLACED || code == TRADE_RETCODE_DONE_PARTIAL || code == TRADE_RETCODE_NO_CHANGES;
}

bool CancelAllPending(string reason)
{
   bool all_clear = true;
   ulong now = GetTickCount64();
   if(last_cancel_request_ms > 0 && now - last_cancel_request_ms < (ulong)MathMax(100, InpPendingCancelRetryMilliseconds))
      return CountOurPending() == 0;

   for(int i=OrdersTotal()-1; i>=0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0 || !OrderSelect(ticket)) continue;
      if(!IsOurSelectedOrder()) continue;

      ENUM_ORDER_STATE state = (ENUM_ORDER_STATE)OrderGetInteger(ORDER_STATE);
      if(state != ORDER_STATE_PLACED && state != ORDER_STATE_PARTIAL && state != ORDER_STATE_STARTED) continue;

      if(OrderInsideFreezeZone())
      {
         all_clear = false;
         last_event = "Pending order entered broker freeze zone; cancellation deferred and any fill will remain protected";
         continue;
      }

      ENUM_ORDER_TYPE order_type = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      double order_volume = OrderGetDouble(ORDER_VOLUME_CURRENT);
      double order_price = OrderGetDouble(ORDER_PRICE_OPEN);
      string order_type_text = order_type == ORDER_TYPE_BUY_STOP ? "BUY_STOP" : "SELL_STOP";
      last_cancel_request_ms = now;
      ResetLastError();
      bool submitted = trade.OrderDelete(ticket);
      uint code = trade.ResultRetcode();
      if(submitted && IsAcceptedTradeRetcode(code))
      {
         QueueOrderReport("CANCELLED", "CONTINUATION", order_type_text, ticket, order_volume, order_price, reason);
         continue;
      }

      if(!OrderSelect(ticket)) continue;
      all_clear = false;
      last_event = StringFormat("Cancel deferred for order %I64u: %u %s", ticket, code, trade.ResultRetcodeDescription());
      Print("EVE TD v1.02 ", last_event, " reason=", reason, " MQL=", GetLastError());
   }
   return all_clear && CountOurPending() == 0;
}

bool OrderInsideFreezeZone()
{
   MqlTick tick;
   if(!SymbolInfoTick(trade_symbol, tick)) return false;
   double point = SymbolInfoDouble(trade_symbol, SYMBOL_POINT);
   double freeze = (double)SymbolInfoInteger(trade_symbol, SYMBOL_TRADE_FREEZE_LEVEL) * point;
   if(freeze <= 0.0) return false;
   ENUM_ORDER_TYPE type = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
   double price = OrderGetDouble(ORDER_PRICE_OPEN);
   double reference = type == ORDER_TYPE_BUY_STOP ? tick.ask : tick.bid;
   return MathAbs(price - reference) <= freeze + point * 2.0;
}

void ManageIndividualProtection(const MqlTick &tick)
{
   double atr = momentum.atr > 0.0 ? momentum.atr : CurrentATR();
   if(atr <= 0.0) return;
   double min_distance = BrokerMinimumDistancePrice() + SymbolInfoDouble(trade_symbol, SYMBOL_POINT) * 2.0;
   double spread_price = tick.ask - tick.bid;

   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket) || !IsOurSelectedPosition()) continue;

      ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double desired_tp = tp;
      double current = type == POSITION_TYPE_BUY ? tick.bid : tick.ask;
      double progress = type == POSITION_TYPE_BUY ? current - open : open - current;
      double desired = sl;

      if(sl <= 0.0)
      {
         desired = type == POSITION_TYPE_BUY ? open - MathMax(atr * InpStopLossATR, min_distance)
                                             : open + MathMax(atr * InpStopLossATR, min_distance);
      }
      if(tp <= 0.0)
      {
         double intended_tp = type == POSITION_TYPE_BUY ? open + MathMax(atr * InpTakeProfitATR, min_distance)
                                                        : open - MathMax(atr * InpTakeProfitATR, min_distance);
         desired_tp = type == POSITION_TYPE_BUY ? MathMax(intended_tp, tick.ask + min_distance)
                                                 : MathMin(intended_tp, tick.bid - min_distance);
      }

      double buffer = MathMax(atr * InpBreakEvenBufferATR, spread_price + SymbolInfoDouble(trade_symbol, SYMBOL_POINT) * 2.0);
      if(InpUseBreakEven && progress >= atr * InpBreakEvenTriggerATR)
      {
         double be = type == POSITION_TYPE_BUY ? open + buffer : open - buffer;
         desired = BetterStop(type, desired, be);
      }

      if(InpUseTrailingStop && progress >= atr * InpTrailingActivationATR)
      {
         double trail = type == POSITION_TYPE_BUY ? tick.bid - atr * InpTrailingDistanceATR
                                                  : tick.ask + atr * InpTrailingDistanceATR;
         desired = BetterStop(type, desired, trail);
      }

      desired = ClampLegalStop(type, desired, tick, min_distance);
      bool stop_change = StopImprovesEnough(type, sl, desired, atr);
      bool tp_change = tp <= 0.0 && desired_tp > 0.0;
      if(!stop_change && !tp_change) continue;
      if(!CanModifyTicket(ticket)) continue;
      double requested_sl = stop_change ? desired : sl;

      ResetLastError();
      bool submitted = trade.PositionModify(ticket, NormalisePrice(requested_sl), NormalisePrice(desired_tp));
      uint code = trade.ResultRetcode();
      RememberModify(ticket);
      if(!submitted || !IsAcceptedTradeRetcode(code))
      {
         PrintFormat("EVE TD v1.02 position %I64u protection modify rejected %u %s MQL=%d", ticket, code, trade.ResultRetcodeDescription(), GetLastError());
      }
   }
}

double BetterStop(ENUM_POSITION_TYPE type, double current_stop, double candidate)
{
   if(current_stop <= 0.0) return candidate;
   if(type == POSITION_TYPE_BUY) return MathMax(current_stop, candidate);
   return MathMin(current_stop, candidate);
}

double ClampLegalStop(ENUM_POSITION_TYPE type, double desired, const MqlTick &tick, double min_distance)
{
   if(type == POSITION_TYPE_BUY) return MathMin(desired, tick.bid - min_distance);
   return MathMax(desired, tick.ask + min_distance);
}

bool StopImprovesEnough(ENUM_POSITION_TYPE type, double old_sl, double new_sl, double atr)
{
   if(new_sl <= 0.0) return false;
   double step = MathMax(SymbolInfoDouble(trade_symbol, SYMBOL_POINT) * 2.0, atr * InpMinimumTrailStepATR);
   if(old_sl <= 0.0) return true;
   if(type == POSITION_TYPE_BUY) return new_sl >= old_sl + step;
   return new_sl <= old_sl - step;
}

bool CanModifyTicket(ulong ticket)
{
   ulong now = GetTickCount64();
   for(int i=0; i<modified_count; i++)
      if(modified_tickets[i] == ticket) return now - modified_times[i] >= 750;
   return true;
}

void RememberModify(ulong ticket)
{
   ulong now = GetTickCount64();
   for(int i=0; i<modified_count; i++)
   {
      if(modified_tickets[i] == ticket)
      {
         modified_times[i] = now;
         return;
      }
   }
   if(modified_count < MODIFY_MEMORY_SIZE)
   {
      modified_tickets[modified_count] = ticket;
      modified_times[modified_count] = now;
      modified_count++;
   }
}

void UpdateNewestLegStats()
{
   ulong latest_ticket = 0;
   ulong latest_identifier = 0;
   long latest_open_msc = -1;
   datetime latest_open_time = 0;
   double latest_profit = 0.0;

   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket) || !IsOurSelectedPosition()) continue;
      long opened_msc = PositionGetInteger(POSITION_TIME_MSC);
      if(opened_msc > latest_open_msc || (opened_msc == latest_open_msc && ticket > latest_ticket))
      {
         latest_open_msc = opened_msc;
         latest_ticket = ticket;
         latest_identifier = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
         latest_open_time = (datetime)PositionGetInteger(POSITION_TIME);
         latest_profit = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      }
   }

   if(latest_ticket == 0)
   {
      newest_ticket = 0;
      newest_position_id = 0;
      newest_leg_open_time = 0;
      newest_leg_current_profit = 0.0;
      newest_leg_peak_profit = 0.0;
      return;
   }

   if(latest_identifier != newest_position_id || latest_ticket != newest_ticket)
   {
      newest_ticket = latest_ticket;
      newest_position_id = latest_identifier;
      newest_leg_open_time = latest_open_time;
      newest_leg_current_profit = latest_profit;
      newest_leg_peak_profit = latest_profit;
      return;
   }

   newest_leg_current_profit = latest_profit;
   newest_leg_peak_profit = MathMax(newest_leg_peak_profit, latest_profit);
}

double EstimatedOneLegRiskMoney()
{
   double atr = momentum.atr > 0.0 ? momentum.atr : CurrentATR();
   if(atr <= 0.0) return 0.0;
   double price_risk = MathMax(atr * InpStopLossATR, BrokerMinimumDistancePrice());
   double tick_size = SymbolInfoDouble(trade_symbol, SYMBOL_TRADE_TICK_SIZE);
   double tick_value = SymbolInfoDouble(trade_symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tick_value <= 0.0) tick_value = SymbolInfoDouble(trade_symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tick_size <= 0.0 || tick_value <= 0.0) return 0.0;
   return (price_risk / tick_size) * tick_value * EffectiveLot();
}

double EstimatedBasketCommissionReserve()
{
   double lot_units = EffectiveLot() > 0.0 ? EffectiveLot() / 0.01 : 1.0;
   return CountOurPositions() * MathMax(0.0, InpCommissionReservePer001Lot) * lot_units;
}

double BasketLockTriggerMoney()
{
   double risk_based = EstimatedOneLegRiskMoney() * MathMax(0.0, InpBasketLockTriggerRiskFraction);
   double cost_based = EstimatedBasketCommissionReserve() + 0.10;
   return MathMax(MathMax(MathMax(0.01, InpBasketLockMinimumMoney), risk_based), cost_based);
}

bool FirstLegFailureTriggered(const MqlTick &tick, double &adverse_price, double &threshold_price)
{
   adverse_price = 0.0;
   threshold_price = 0.0;
   if(!InpUseFirstLegFailureExit || basket_close_requested) return false;
   if(campaign_started_at <= 0 || campaign_entries != 1 || CountOurPositions() != 1) return false;
   if(first_leg_entry_price <= 0.0 || first_leg_position_id == 0) return false;

   double atr = first_leg_entry_atr > 0.0 ? first_leg_entry_atr : (momentum.atr > 0.0 ? momentum.atr : CurrentATR());
   if(atr <= 0.0) return false;

   double point = SymbolInfoDouble(trade_symbol, SYMBOL_POINT);
   threshold_price = MathMax(point * 2.0, atr * MathMax(0.01, InpFirstLegFailureATR));
   if(campaign_side == "BUY")
      adverse_price = first_leg_entry_price - tick.bid;
   else if(campaign_side == "SELL")
      adverse_price = tick.ask - first_leg_entry_price;
   else
      return false;

   return adverse_price + point * 0.10 >= threshold_price;
}

void ManageBasketProtection(const MqlTick &tick)
{
   if(CountOurPositions() <= 0 || basket_close_requested) return;
   UpdateCampaignStats();

   double first_leg_adverse = 0.0;
   double first_leg_threshold = 0.0;
   if(FirstLegFailureTriggered(tick, first_leg_adverse, first_leg_threshold))
   {
      double validation_atr = first_leg_entry_atr > 0.0 ? first_leg_entry_atr : momentum.atr;
      double adverse_atr = validation_atr > 0.0 ? first_leg_adverse / validation_atr : InpFirstLegFailureATR;
      RequestBasketClose(StringFormat("FIRST LEG BURST FAILED %.2f ATR ADVERSE (%.2f >= %.2f) BEFORE LEG 2", adverse_atr, first_leg_adverse, first_leg_threshold));
      return;
   }

   if(newest_leg_sl_exit_detected)
   {
      newest_leg_sl_exit_detected = false;
      RequestBasketClose("NEWEST LEG BROKER SL - BANK REMAINING POSITIONS");
      return;
   }

   if(!InpUseBasketProfitLock) return;
   double trigger = BasketLockTriggerMoney();
   if(campaign_peak_floating + 0.0001 < trigger) return;

   double retain = MathMax(5.0, MathMin(95.0, InpBasketLockRetainPercent)) / 100.0;
   double protected_floor = MathMax(EstimatedBasketCommissionReserve() + 0.05, campaign_peak_floating * retain);
   double current = BasketFloatingProfit();
   if(current <= protected_floor)
      RequestBasketClose(StringFormat("BASKET PROFIT LOCK %.2f FLOOR AFTER %.2f PEAK", protected_floor, campaign_peak_floating));
}

void RequestBasketClose(string reason)
{
   if(basket_close_requested) return;
   if(CountOurPositions() <= 0 && campaign_started_at <= 0)
   {
      CancelAllPending(reason);
      last_event = reason + ": no open basket";
      return;
   }
   basket_close_requested = true;
   basket_close_reason = reason;
   campaign_exit_reason = reason;
   adding_stopped = true;
   QueueBankDecision(reason, BasketFloatingProfit());
   CancelAllPending(reason);
   if(CountOurPositions() > 0)
   {
      basket_close_attempts++;
      CloseAllPositions(reason);
   }
   last_event = reason;
}

string DealReasonText(ENUM_DEAL_REASON reason)
{
   switch(reason)
   {
      case DEAL_REASON_CLIENT: return "CLIENT";
      case DEAL_REASON_MOBILE: return "MOBILE";
      case DEAL_REASON_WEB: return "WEB";
      case DEAL_REASON_EXPERT: return "EXPERT";
      case DEAL_REASON_SL: return "STOP LOSS";
      case DEAL_REASON_TP: return "TAKE PROFIT";
      case DEAL_REASON_SO: return "STOP OUT";
   }
   return "OTHER";
}

void EnforceCapitalProtection()
{
   if(BasketEmergencyReached())
      RequestBasketClose("EMERGENCY BASKET LOSS LIMIT");
}

bool BasketEmergencyReached()
{
   if(InpEmergencyBasketLossPercent <= 0.0 || CountOurPositions() == 0) return false;
   double maximum_loss = AccountInfoDouble(ACCOUNT_BALANCE) * InpEmergencyBasketLossPercent / 100.0;
   return BasketFloatingProfit() <= -maximum_loss;
}

bool DailyLossBlocked()
{
   if(InpMaximumDailyLossPercent <= 0.0) return false;
   double pnl = DailyRealisedProfit();
   double estimated_start = AccountInfoDouble(ACCOUNT_BALANCE) - pnl;
   if(estimated_start <= 0.0) return false;
   return pnl <= -(estimated_start * InpMaximumDailyLossPercent / 100.0);
}

double DailyRealisedProfit()
{
   ulong now_ms = GetTickCount64();
   if(cached_daily_pnl_ms > 0 && now_ms - cached_daily_pnl_ms < 1000) return cached_daily_pnl;
   MqlDateTime parts;
   TimeToStruct(TimeCurrent(), parts);
   parts.hour = 0; parts.min = 0; parts.sec = 0;
   datetime start = StructToTime(parts);
   if(!HistorySelect(start, TimeCurrent() + 60)) return cached_daily_pnl;
   double total = 0.0;
   for(int i=0; i<HistoryDealsTotal(); i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      if(HistoryDealGetString(deal, DEAL_SYMBOL) != trade_symbol) continue;
      if((ulong)HistoryDealGetInteger(deal, DEAL_MAGIC) != InpMagicNumber) continue;
      ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT) continue;
      total += HistoryDealGetDouble(deal, DEAL_PROFIT) +
               HistoryDealGetDouble(deal, DEAL_COMMISSION) +
               HistoryDealGetDouble(deal, DEAL_SWAP) +
               HistoryDealGetDouble(deal, DEAL_FEE);
   }
   cached_daily_pnl = total;
   cached_daily_pnl_ms = now_ms;
   return total;
}

double CampaignRealisedProfit()
{
   if(campaign_started_at <= 0) return AccountInfoDouble(ACCOUNT_BALANCE) - campaign_start_balance;
   if(!HistorySelect(campaign_started_at - 2, TimeCurrent() + 60)) return 0.0;
   double total = 0.0;
   for(int i=0; i<HistoryDealsTotal(); i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      if(HistoryDealGetString(deal, DEAL_SYMBOL) != trade_symbol) continue;
      if((ulong)HistoryDealGetInteger(deal, DEAL_MAGIC) != InpMagicNumber) continue;
      total += HistoryDealGetDouble(deal, DEAL_PROFIT) +
               HistoryDealGetDouble(deal, DEAL_COMMISSION) +
               HistoryDealGetDouble(deal, DEAL_SWAP) +
               HistoryDealGetDouble(deal, DEAL_FEE);
   }
   return total;
}

bool CloseAllPositions(string reason)
{
   bool all_closed = true;
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket) || !IsOurSelectedPosition()) continue;
      ResetLastError();
      bool submitted = trade.PositionClose(ticket, InpSlippagePoints);
      uint code = trade.ResultRetcode();
      if(!submitted || !IsAcceptedTradeRetcode(code))
      {
         all_closed = false;
         PrintFormat("EVE TD v1.02 close %I64u failed %u %s MQL=%d", ticket, code, trade.ResultRetcodeDescription(), GetLastError());
      }
   }
   last_event = reason + (all_closed ? ": close requests accepted" : ": some close requests require retry");
   return all_closed;
}

int CountOurPositions()
{
   int count = 0;
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionSelectByTicket(ticket) && IsOurSelectedPosition()) count++;
   }
   return count;
}

int CountOurPending()
{
   int count = 0;
   for(int i=OrdersTotal()-1; i>=0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket > 0 && OrderSelect(ticket) && IsOurSelectedOrder()) count++;
   }
   return count;
}

bool IsOurSelectedPosition()
{
   return PositionGetString(POSITION_SYMBOL) == trade_symbol &&
          (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagicNumber;
}

bool IsOurSelectedOrder()
{
   if(OrderGetString(ORDER_SYMBOL) != trade_symbol) return false;
   if((ulong)OrderGetInteger(ORDER_MAGIC) != InpMagicNumber) return false;
   ENUM_ORDER_TYPE type = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
   return type == ORDER_TYPE_BUY_STOP || type == ORDER_TYPE_SELL_STOP;
}

string OurPositionSide()
{
   int buys = 0, sells = 0;
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket) || !IsOurSelectedPosition()) continue;
      ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      if(type == POSITION_TYPE_BUY) buys++; else if(type == POSITION_TYPE_SELL) sells++;
   }
   if(buys > 0 && sells == 0) return "BUY";
   if(sells > 0 && buys == 0) return "SELL";
   return "NONE";
}

string OurPendingSide()
{
   for(int i=OrdersTotal()-1; i>=0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0 || !OrderSelect(ticket) || !IsOurSelectedOrder()) continue;
      ENUM_ORDER_TYPE type = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      return type == ORDER_TYPE_BUY_STOP ? "BUY" : "SELL";
   }
   return "NONE";
}

double BasketFloatingProfit()
{
   double total = 0.0;
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket) || !IsOurSelectedPosition()) continue;
      total += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   }
   return total;
}

double OurTotalLots()
{
   double total = 0.0;
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket) || !IsOurSelectedPosition()) continue;
      total += PositionGetDouble(POSITION_VOLUME);
   }
   return total;
}

double HighestOurEntry()
{
   double highest = 0.0;
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket) || !IsOurSelectedPosition()) continue;
      highest = MathMax(highest, PositionGetDouble(POSITION_PRICE_OPEN));
   }
   return highest;
}

double LowestOurEntry()
{
   double lowest = 0.0;
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket) || !IsOurSelectedPosition()) continue;
      double price = PositionGetDouble(POSITION_PRICE_OPEN);
      if(lowest <= 0.0 || price < lowest) lowest = price;
   }
   return lowest;
}

double BrokerMinimumDistancePrice()
{
   double point = SymbolInfoDouble(trade_symbol, SYMBOL_POINT);
   long stops = SymbolInfoInteger(trade_symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long freeze = SymbolInfoInteger(trade_symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   return MathMax((double)stops, (double)freeze) * point;
}

double NormalisePrice(double price)
{
   int digits = (int)SymbolInfoInteger(trade_symbol, SYMBOL_DIGITS);
   return NormalizeDouble(price, digits);
}

double EffectiveLot()
{
   double lot = runtime_fixed_lot;
   if(runtime_use_equity_scaling && runtime_equity_per_001 > 0.0)
   {
      double units = MathFloor(AccountInfoDouble(ACCOUNT_EQUITY) / runtime_equity_per_001);
      if(units < 1.0) units = 1.0;
      lot = units * 0.01;
   }
   return NormaliseVolume(lot);
}

double NormaliseVolume(double volume)
{
   double minimum = SymbolInfoDouble(trade_symbol, SYMBOL_VOLUME_MIN);
   double maximum = SymbolInfoDouble(trade_symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(trade_symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0.0) step = minimum > 0.0 ? minimum : 0.01;
   volume = MathMax(minimum, MathMin(maximum, volume));
   volume = MathFloor(volume / step + 0.0000001) * step;
   return NormalizeDouble(volume, 2);
}

string EngineStateText()
{
   switch(engine_state)
   {
      case STATE_WARMING: return "WARMING";
      case STATE_IDLE: return reset_required ? "WAITING FOR QUIET RESET" : "WAITING FOR BURST";
      case STATE_ARMED: return "CONTINUATION STOP ARMED";
      case STATE_RUNNING: return adding_stopped ? "POSITIONS MANAGED - ADDING STOPPED" : "MOMENTUM CAMPAIGN ACTIVE";
      case STATE_CANCELLING: return "CANCELLING STALE PENDING";
      case STATE_PAUSED: return "PAUSED";
      case STATE_EMERGENCY: return "EMERGENCY STOP";
   }
   return "UNKNOWN";
}

void QueueTelemetry(string endpoint, string payload)
{
   if(endpoint == "" || payload == "") return;
   if(telemetry_count >= TELEMETRY_QUEUE_SIZE)
   {
      telemetry_tail = (telemetry_tail + 1) % TELEMETRY_QUEUE_SIZE;
      telemetry_count--;
   }
   telemetry_endpoints[telemetry_head] = endpoint;
   telemetry_payloads[telemetry_head] = payload;
   telemetry_head = (telemetry_head + 1) % TELEMETRY_QUEUE_SIZE;
   telemetry_count++;
}

bool FlushOneTelemetry()
{
   if(telemetry_count <= 0) return true;
   string endpoint = telemetry_endpoints[telemetry_tail];
   string payload = telemetry_payloads[telemetry_tail];
   if(!PostJson(endpoint, payload)) return false;
   telemetry_endpoints[telemetry_tail] = "";
   telemetry_payloads[telemetry_tail] = "";
   telemetry_tail = (telemetry_tail + 1) % TELEMETRY_QUEUE_SIZE;
   telemetry_count--;
   return true;
}

void QueueLegReport(string action, string side, ulong ticket, ulong position_id, double volume, double price, double net_profit, string reason)
{
   long now_ms = (long)TimeCurrent() * 1000;
   string json = StringFormat(
      "{\"id\":\"%I64d-%I64u-%s\",\"account\":\"%I64d\",\"symbol\":\"%s\",\"version\":\"1.02\",\"strategy\":\"TWELVE_DATA_CONFIRMED_BREAKOUT_TRADER\",\"magic\":\"%I64u\",\"dealTime\":%I64d,\"action\":\"%s\",\"side\":\"%s\",\"ticket\":\"%I64u\",\"positionId\":\"%I64u\",\"volume\":%.2f,\"price\":%.5f,\"netProfit\":%.2f,\"reason\":\"%s\"}",
      now_ms, ticket, JsonEscape(action), AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(trade_symbol), InpMagicNumber,
      now_ms, JsonEscape(action), JsonEscape(side), ticket, position_id, volume, price, net_profit, JsonEscape(reason));
   QueueTelemetry("/api/ea/leg", json);
}

void QueueOrderReport(string action, string role, string order_type, ulong ticket, double volume, double price, string reason)
{
   long now_ms = (long)TimeCurrent() * 1000;
   string json = StringFormat(
      "{\"id\":\"%I64d-%I64u-%s\",\"account\":\"%I64d\",\"symbol\":\"%s\",\"version\":\"1.02\",\"strategy\":\"TWELVE_DATA_CONFIRMED_BREAKOUT_TRADER\",\"magic\":\"%I64u\",\"at\":%I64d,\"action\":\"%s\",\"role\":\"%s\",\"orderType\":\"%s\",\"ticket\":\"%I64u\",\"volume\":%.2f,\"price\":%.5f,\"reason\":\"%s\"}",
      now_ms, ticket, JsonEscape(action), AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(trade_symbol), InpMagicNumber,
      now_ms, JsonEscape(action), JsonEscape(role), JsonEscape(order_type), ticket, volume, price, JsonEscape(reason));
   QueueTelemetry("/api/ea/order", json);
}

void QueueBankDecision(string reason, double basket_profit)
{
   int same_score = campaign_side == "BUY" ? momentum.buyScore : momentum.sellScore;
   int opposite_score = campaign_side == "BUY" ? momentum.sellScore : momentum.buyScore;
   long now_ms = (long)TimeCurrent() * 1000;
   string json = StringFormat(
      "{\"id\":\"%I64d-%I64u\",\"account\":\"%I64d\",\"symbol\":\"%s\",\"version\":\"1.02\",\"strategy\":\"TWELVE_DATA_CONFIRMED_BREAKOUT_TRADER\",\"magic\":\"%I64u\",\"side\":\"%s\",\"basketProfit\":%.2f,\"peakBasketProfit\":%.2f,\"newestTicket\":\"%I64u\",\"newestProfit\":%.2f,\"newestPeak\":%.2f,\"sameScore\":%d,\"oppositeScore\":%d,\"momentumState\":\"%s\",\"reason\":\"%s\",\"at\":%I64d}",
      now_ms, newest_ticket, AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(trade_symbol), InpMagicNumber, JsonEscape(campaign_side),
      basket_profit, campaign_peak_floating, newest_ticket, newest_leg_current_profit, newest_leg_peak_profit,
      same_score, opposite_score, JsonEscape(momentum.reason), JsonEscape(reason), now_ms);
   QueueTelemetry("/api/ea/bank", json);
}

void MaybeQueueScanReport()
{
   if(InpScanLogSeconds <= 0 || !momentum.ready) return;
   ulong now = GetTickCount64();
   ulong interval = (ulong)MathMax(1, InpScanLogSeconds) * 1000;
   if(last_scan_log_ms > 0 && now - last_scan_log_ms < interval) return;
   last_scan_log_ms = now;

   string block_reason = remote_decision_reason;
   if(local_paused) block_reason = "LOCAL_EA_PAUSED";
   else if(emergency_stopped) block_reason = "EMERGENCY_STOP_ACTIVE";
   else if(!remote_autonomous) block_reason = "RAILWAY_AUTONOMOUS_DISABLED";
   else if(!TerminalInfoInteger(TERMINAL_CONNECTED)) block_reason = "MT5_TERMINAL_DISCONNECTED";
   else if(!MQLInfoInteger(MQL_TRADE_ALLOWED)) block_reason = "MT5_ALGO_TRADING_BLOCKED";
   else if(!SpreadOkay()) block_reason = StringFormat("BROKER_SPREAD_%.1F_POINTS_ABOVE_%d", CurrentSpreadPoints(), InpMaximumSpreadPoints);
   else if(DailyLossBlocked()) block_reason = "MAXIMUM_DAILY_LOSS_REACHED";
   else if(CountOurPositions() > 0 && !MomentumSupportsCampaign()) block_reason = "CONTINUATION_NOT_ALLOWED_BY_TWELVE_DATA_OR_LOCAL_MOMENTUM";
   else if(reset_required) block_reason = "WAITING_FOR_QUIET_RESET";
   else if(remote_decision_action == "BUY" || remote_decision_action == "SELL") block_reason = "TRADE_DECISION_ACTIVE";

   long now_ms = (long)TimeCurrent() * 1000;
   string json = StringFormat(
      "{\"id\":\"%I64d\",\"account\":\"%I64d\",\"symbol\":\"%s\",\"version\":\"1.02\",\"strategy\":\"TWELVE_DATA_CONFIRMED_BREAKOUT_TRADER\",\"magic\":\"%I64u\",\"decisionId\":\"%s\",\"decisionAction\":\"%s\",\"decisionDirection\":\"%s\",\"decisionQuality\":%.2f,\"buyQuality\":%.2f,\"sellQuality\":%.2f,\"addAllowed\":%s,\"regime\":\"%s\",\"m5\":\"%s\",\"m15\":\"%s\",\"h1\":\"%s\",\"localMomentumState\":\"%s\",\"localBuyScore\":%d,\"localSellScore\":%d,\"velocity1s\":%.5f,\"velocity3s\":%.5f,\"velocity10s\":%.5f,\"tickRateRatio\":%.3f,\"acceleration\":%.3f,\"bodyAtr\":%.3f,\"blockReason\":\"%s\"}",
      now_ms, AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(trade_symbol), InpMagicNumber,
      JsonEscape(remote_decision_id), JsonEscape(remote_decision_action), JsonEscape(remote_decision_direction), remote_decision_quality,
      remote_buy_quality, remote_sell_quality, remote_add_allowed ? "true" : "false", JsonEscape(remote_decision_regime),
      JsonEscape(remote_decision_m5), JsonEscape(remote_decision_m15), JsonEscape(remote_decision_h1), JsonEscape(momentum.reason),
      momentum.buyScore, momentum.sellScore, momentum.velocity1, momentum.velocity3, momentum.velocity10,
      momentum.tickRatio, momentum.acceleration, momentum.bodyATR, JsonEscape(block_reason));
   QueueTelemetry("/api/ea/event", StringFormat("{\"type\":\"mt5_scan\",\"message\":\"MT5 execution scan\",\"data\":%s}", json));
}

void ProcessRailway()
{
   string base = TrimTrailingSlash(InpRailwayBaseUrl);
   if(base == "" || StringFind(base, "YOUR-SERVICE") >= 0 || InpBotToken == "CHANGE-ME") return;
   ulong now = GetTickCount64();
   if(now < next_http_allowed_ms) return;

   if(queued_basket_json != "")
   {
      if(PostJson("/api/ea/basket", queued_basket_json)) queued_basket_json = "";
      return;
   }

   ulong heartbeat_interval = (ulong)MathMax(2, InpHeartbeatSeconds) * 1000;
   ulong poll_interval = (ulong)MathMax(1, InpCommandPollSeconds) * 1000;
   if(last_heartbeat_ms == 0 || now - last_heartbeat_ms >= heartbeat_interval)
   {
      SendHeartbeat();
      last_heartbeat_ms = now;
      return;
   }
   if(telemetry_count > 0)
   {
      FlushOneTelemetry();
      return;
   }
   if(last_poll_ms == 0 || now - last_poll_ms >= poll_interval)
   {
      PollRailway();
      last_poll_ms = now;
   }
}

void SendHeartbeat()
{
   MqlTick tick;
   SymbolInfoTick(trade_symbol, tick);
   int positions = CountOurPositions();
   int newest_age = newest_leg_open_time > 0 ? (int)(TimeCurrent() - newest_leg_open_time) : 0;
   string json = StringFormat(
      "{\"account\":\"%I64d\",\"symbol\":\"%s\",\"version\":\"1.02\",\"magic\":\"%I64u\",\"strategy\":\"TWELVE_DATA_CONFIRMED_BREAKOUT_TRADER\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"freeMargin\":%.2f,\"bid\":%.5f,\"ask\":%.5f,\"spreadPoints\":%.1f,\"atrM1\":%.5f,\"terminalConnected\":%s,\"algoAllowed\":%s,\"autonomous\":%s,\"emergency\":%s,\"engineState\":\"%s\",\"positionCount\":%d,\"pendingCount\":%d,\"side\":\"%s\",\"totalLots\":%.2f,\"averageEntry\":%.5f,\"floatingProfit\":%.2f,\"peakBasketProfit\":%.2f,\"basketMae\":%.2f,\"positionsOpened\":%d,\"newestTicket\":\"%I64u\",\"newestLegProfit\":%.2f,\"newestLegPeak\":%.2f,\"newestLegAgeSeconds\":%d,\"dailyPnl\":%.2f,\"localBuyScore\":%d,\"localSellScore\":%d,\"velocity1s\":%.5f,\"velocity3s\":%.5f,\"velocity10s\":%.5f,\"tickRateRatio\":%.3f,\"acceleration\":%.3f,\"bodyAtr\":%.3f,\"remoteDecisionId\":\"%s\",\"remoteDecisionAction\":\"%s\",\"remoteDecisionDirection\":\"%s\",\"remoteDecisionQuality\":%.2f,\"remoteBuyQuality\":%.2f,\"remoteSellQuality\":%.2f,\"remoteAddAllowed\":%s,\"remoteDecisionReason\":\"%s\",\"consumedDecisionId\":\"%s\",\"consumedCommandId\":%I64d,\"lastEvent\":\"%s\",\"lastCommandResult\":\"%s\"}",
      AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(trade_symbol), InpMagicNumber,
      AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY), AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE), tick.bid, tick.ask, CurrentSpreadPoints(), CurrentATR(),
      TerminalInfoInteger(TERMINAL_CONNECTED) ? "true" : "false", MQLInfoInteger(MQL_TRADE_ALLOWED) ? "true" : "false",
      (remote_autonomous && !local_paused) ? "true" : "false", emergency_stopped ? "true" : "false",
      JsonEscape(EngineStateText()), positions, CountOurPending(), JsonEscape(OurPositionSide()), OurTotalLots(), AverageEntry(),
      BasketFloatingProfit(), campaign_peak_floating, campaign_worst_floating, campaign_entries, newest_ticket,
      newest_leg_current_profit, newest_leg_peak_profit, newest_age, DailyRealisedProfit(), momentum.buyScore, momentum.sellScore,
      momentum.velocity1, momentum.velocity3, momentum.velocity10, momentum.tickRatio, momentum.acceleration, momentum.bodyATR,
      JsonEscape(remote_decision_id), JsonEscape(remote_decision_action), JsonEscape(remote_decision_direction), remote_decision_quality,
      remote_buy_quality, remote_sell_quality, remote_add_allowed ? "true" : "false", JsonEscape(remote_decision_reason),
      JsonEscape(consumed_decision_id), last_command_id, JsonEscape(last_event), JsonEscape(last_command_result));
   PostJson("/api/ea/heartbeat", json);
}

void PollRailway()
{
   string base = TrimTrailingSlash(InpRailwayBaseUrl);
   string url = base + "/api/ea/control?token=" + InpBotToken;
   char data[];
   char result[];
   string response_headers;
   ResetLastError();
   ulong request_started_ms = GetTickCount64();
   int status = WebRequest("GET", url, "", "", InpWebTimeoutMilliseconds, data, 0, result, response_headers);
   if(status != 200)
   {
      RegisterHttpFailure("control", status, CharArrayToString(result));
      return;
   }
   RegisterHttpSuccess("control");
   string body = CharArrayToString(result);
   ulong response_received_ms = GetTickCount64();
   remote_autonomous = ParseLineValue(body, "autonomous") == "true";
   remote_decision_id = ParseLineValue(body, "decision_id");
   remote_decision_action = ParseLineValue(body, "decision_action");
   remote_decision_direction = ParseLineValue(body, "decision_direction");
   remote_decision_quality = StringToDouble(ParseLineValue(body, "decision_quality"));
   remote_buy_quality = StringToDouble(ParseLineValue(body, "decision_buy_quality"));
   remote_sell_quality = StringToDouble(ParseLineValue(body, "decision_sell_quality"));
   remote_add_allowed = ParseLineValue(body, "decision_add_allowed") == "true";
   remote_decision_valid_until = StringToInteger(ParseLineValue(body, "decision_valid_until"));
   long server_now_ms = StringToInteger(ParseLineValue(body, "server_now_ms"));
   long server_ttl_ms = StringToInteger(ParseLineValue(body, "decision_ttl_remaining_ms"));
   if(server_ttl_ms <= 0 && server_now_ms > 0 && remote_decision_valid_until > server_now_ms)
      server_ttl_ms = remote_decision_valid_until - server_now_ms;
   long request_elapsed_ms = (long)(response_received_ms - request_started_ms);
   remote_decision_ttl_remaining_ms = MathMax(0, server_ttl_ms - request_elapsed_ms);
   long maximum_local_age_ms = (long)MathMax(1, InpDecisionMaximumAgeSeconds) * 1000;
   long usable_ttl_ms = MathMin(remote_decision_ttl_remaining_ms, maximum_local_age_ms);
   remote_decision_received_ms = response_received_ms;
   remote_decision_local_valid_until_ms = usable_ttl_ms > 0 ? response_received_ms + (ulong)usable_ttl_ms : 0;
   remote_decision_reason = ParseLineValue(body, "decision_reason");
   remote_decision_regime = ParseLineValue(body, "decision_regime");
   remote_decision_m5 = ParseLineValue(body, "decision_m5");
   remote_decision_m15 = ParseLineValue(body, "decision_m15");
   remote_decision_h1 = ParseLineValue(body, "decision_h1");
   bool remote_emergency = ParseLineValue(body, "emergency") == "true";
   int incoming_settings_version = (int)StringToInteger(ParseLineValue(body, "settings_version"));
   if(incoming_settings_version > runtime_settings_version)
   {
      double incoming_lot = StringToDouble(ParseLineValue(body, "fixed_lot"));
      if(incoming_lot > 0.0) runtime_fixed_lot = incoming_lot;
      runtime_use_equity_scaling = ParseLineValue(body, "use_equity_scaling") == "true";
      double incoming_equity_per = StringToDouble(ParseLineValue(body, "equity_per_001_lot"));
      if(incoming_equity_per > 0.0) runtime_equity_per_001 = incoming_equity_per;
      runtime_settings_version = incoming_settings_version;
      last_event = StringFormat("Dashboard lot settings applied: %.2f effective lot", EffectiveLot());
   }
   long command_id = StringToInteger(ParseLineValue(body, "command_id"));
   string action = ParseLineValue(body, "action");
   if(remote_emergency) emergency_stopped = true;
   if(command_id > last_command_id && action != "NONE")
   {
      ExecuteRemoteCommand(action);
      last_command_id = command_id;
      last_command_result = last_event;
   }
}

void ExecuteRemoteCommand(string action)
{
   if(action == "PAUSE_EA" || action == "PAUSE_ADDING")
   {
      local_paused = true;
      CancelAllPending("dashboard pause");
      last_event = "Dashboard paused new entries";
   }
   else if(action == "RESUME_EA" || action == "RESUME_ADDING")
   {
      if(!emergency_stopped) local_paused = false;
      last_event = emergency_stopped ? "Reset emergency before resuming" : "Dashboard resumed EA";
   }
   else if(action == "CLOSE_BASKET" || action == "CLOSE_POSITION")
   {
      RequestBasketClose("DASHBOARD CLOSE");
   }
   else if(action == "EMERGENCY_STOP")
   {
      emergency_stopped = true;
      local_paused = true;
      RequestBasketClose("DASHBOARD EMERGENCY STOP");
   }
   else if(action == "RESET_EMERGENCY")
   {
      emergency_stopped = false;
      local_paused = false;
      last_event = "Emergency stop reset";
   }
   else if(action == "REBUILD_BRACKET")
   {
      CancelAllPending("dashboard reset burst watcher");
      held_signal_side = "NONE";
      held_signal_started_ms = 0;
      last_event = "Burst watcher reset";
   }
   else last_event = "Unsupported dashboard command: " + action;
}

bool PostJson(string endpoint, string json)
{
   string base = TrimTrailingSlash(InpRailwayBaseUrl);
   string url = base + endpoint + "?token=" + InpBotToken;
   char post[];
   char result[];
   string response_headers;
   StringToCharArray(json, post, 0, WHOLE_ARRAY, CP_UTF8);
   int size = ArraySize(post);
   if(size > 0 && post[size-1] == 0) ArrayResize(post, size - 1);
   ResetLastError();
   int status = WebRequest("POST", url, "Content-Type: application/json\r\nConnection: close\r\n", InpWebTimeoutMilliseconds, post, result, response_headers);
   if(status < 200 || status >= 300)
   {
      RegisterHttpFailure(endpoint, status, CharArrayToString(result));
      return false;
   }
   RegisterHttpSuccess(endpoint);
   return true;
}

void RegisterHttpFailure(string endpoint, int status, string response)
{
   http_failure_count++;
   int exponent = http_failure_count < 5 ? http_failure_count : 5;
   int backoff_seconds = 2 * (1 << exponent);
   if(backoff_seconds > 60) backoff_seconds = 60;
   next_http_allowed_ms = GetTickCount64() + (ulong)backoff_seconds * 1000;
   last_http_status = StringFormat("%s HTTP %d MQL %d; retry in %ds", endpoint, status, GetLastError(), backoff_seconds);
   Print("EVE TD v1.02 Railway ", last_http_status, " response=", response);
}

void RegisterHttpSuccess(string endpoint)
{
   http_failure_count = 0;
   next_http_allowed_ms = 0;
   last_http_status = endpoint + " OK";
}

void QueueBasketReport(string side, double realised)
{
   long started_ms = (long)campaign_started_at * 1000;
   long ended_ms = (long)TimeCurrent() * 1000;
   queued_basket_json = StringFormat(
      "{\"id\":\"%I64d-%I64d\",\"account\":\"%I64d\",\"symbol\":\"%s\",\"version\":\"1.02\",\"strategy\":\"TWELVE_DATA_CONFIRMED_BREAKOUT_TRADER\",\"magic\":\"%I64u\",\"status\":\"CLOSED\",\"side\":\"%s\",\"startSide\":\"%s\",\"entryTime\":%I64d,\"exitTime\":%I64d,\"durationSeconds\":%d,\"positionsOpened\":%d,\"lotPerLeg\":%.2f,\"maxTotalLotsUsed\":%.2f,\"netProfit\":%.2f,\"peakBasketProfit\":%.2f,\"mae\":%.2f,\"profitGiveback\":%.2f,\"exitReason\":\"%s\",\"entryRegime\":\"TWELVE DATA QUALITY + MT5 EXECUTION\"}",
      AccountInfoInteger(ACCOUNT_LOGIN), ended_ms, AccountInfoInteger(ACCOUNT_LOGIN), JsonEscape(trade_symbol), InpMagicNumber,
      JsonEscape(side), JsonEscape(side), started_ms, ended_ms, campaign_started_at > 0 ? (int)(TimeCurrent() - campaign_started_at) : 0,
      campaign_entries, EffectiveLot(), campaign_entries * EffectiveLot(), realised, campaign_peak_floating, campaign_worst_floating,
      MathMax(0.0, campaign_peak_floating - realised), JsonEscape(campaign_exit_reason));
}

double PendingPrice(string side)
{
   for(int i=OrdersTotal()-1; i>=0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0 || !OrderSelect(ticket) || !IsOurSelectedOrder()) continue;
      ENUM_ORDER_TYPE type = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      if((side == "BUY" && type == ORDER_TYPE_BUY_STOP) || (side == "SELL" && type == ORDER_TYPE_SELL_STOP))
         return OrderGetDouble(ORDER_PRICE_OPEN);
   }
   return 0.0;
}

double AverageEntry()
{
   double weighted = 0.0, volume = 0.0;
   for(int i=PositionsTotal()-1; i>=0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket) || !IsOurSelectedPosition()) continue;
      double lot = PositionGetDouble(POSITION_VOLUME);
      weighted += PositionGetDouble(POSITION_PRICE_OPEN) * lot;
      volume += lot;
   }
   return volume > 0.0 ? weighted / volume : 0.0;
}

string ParseLineValue(string body, string key)
{
   string marker = key + "=";
   int start = StringFind(body, marker);
   if(start < 0) return "";
   start += StringLen(marker);
   int end = StringFind(body, "\n", start);
   if(end < 0) end = StringLen(body);
   string value = StringSubstr(body, start, end - start);
   StringTrimLeft(value);
   StringTrimRight(value);
   return value;
}

string TrimTrailingSlash(string value)
{
   StringTrimLeft(value);
   StringTrimRight(value);
   while(StringLen(value) > 0 && StringSubstr(value, StringLen(value)-1, 1) == "/")
      value = StringSubstr(value, 0, StringLen(value)-1);
   return value;
}

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", " ");
   StringReplace(value, "\n", " ");
   return value;
}

void CreatePanel()
{
   CreateLabel(PANEL_PREFIX + "TITLE", 12, 18, "EVE TWELVE DATA MOMENTUM TRADER v1.02", 12);
   CreateLabel(PANEL_PREFIX + "STATE", 12, 42, "STATE", 10);
   CreateLabel(PANEL_PREFIX + "MOMENTUM", 12, 62, "MOMENTUM", 9);
   CreateLabel(PANEL_PREFIX + "CAMPAIGN", 12, 82, "CAMPAIGN", 9);
   CreateLabel(PANEL_PREFIX + "HTTP", 12, 102, "RAILWAY", 8);
   CreateButton(PANEL_PREFIX + "PAUSE", 12, 126, 120, 28, "PAUSE EA", clrDarkOrange);
   CreateButton(PANEL_PREFIX + "CLOSE", 142, 126, 120, 28, "CLOSE ALL", clrSlateGray);
   CreateButton(PANEL_PREFIX + "STOP", 272, 126, 120, 28, "EMERGENCY", clrCrimson);
}

void UpdatePanel()
{
   if(!InpShowPanel) return;
   SetLabel(PANEL_PREFIX + "STATE", "STATE: " + EngineStateText());
   SetLabel(PANEL_PREFIX + "MOMENTUM", StringFormat("TD BUY %.0f | SELL %.0f | %s %.0f | add %s | spread %.1f", remote_buy_quality, remote_sell_quality, remote_decision_direction, remote_decision_quality, remote_add_allowed ? "YES" : "NO", CurrentSpreadPoints()));
   SetLabel(PANEL_PREFIX + "CAMPAIGN", StringFormat("%s | positions %d | pending %d | P/L %.2f | every trade has own SL/TP", campaign_side, CountOurPositions(), CountOurPending(), BasketFloatingProfit()));
   SetLabel(PANEL_PREFIX + "HTTP", "RAILWAY: " + last_http_status);
   SetButtonText(PANEL_PREFIX + "PAUSE", local_paused ? "RESUME EA" : "PAUSE EA");
   ChartRedraw();
}

void DeletePanel()
{
   for(int i=ObjectsTotal(0)-1; i>=0; i--)
   {
      string name = ObjectName(0, i);
      if(StringFind(name, PANEL_PREFIX) == 0) ObjectDelete(0, name);
   }
}

void CreateLabel(string name, int x, int y, string text, int size)
{
   if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, size);
   ObjectSetString(0, name, OBJPROP_FONT, "Arial");
   ObjectSetString(0, name, OBJPROP_TEXT, text);
}

void CreateButton(string name, int x, int y, int width, int height, string text, color background)
{
   if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, width);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, height);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, background);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 9);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
}

void SetLabel(string name, string text)
{
   if(ObjectFind(0, name) >= 0) ObjectSetString(0, name, OBJPROP_TEXT, text);
}

void SetButtonText(string name, string text)
{
   if(ObjectFind(0, name) >= 0) ObjectSetString(0, name, OBJPROP_TEXT, text);
}
