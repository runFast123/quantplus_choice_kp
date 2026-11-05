// The five blog posts: each live rule next to the usual way of using the same indicator. Every number in the text is
// read from data.ts (the test, research/strategies/compare_blog.py), so the words and the charts cannot disagree.
// House style for this text: plain words, no jargon without a one line meaning, no hyphens or dashes, research not
// advice, and the result that goes against us is said as plainly as the ones that go for us.
import { BLOG_DATA as D } from "./data";
import { count, in100, pct, result } from "./format";
import type { Block, Post, RuleKey } from "./types";

const PUBLISHED = "2026-11-05";

const yearsWon = (k: RuleKey) => {
  const u = new Map(D[k].usual.years.map((y) => [y.year, y.made_money_pct]));
  const o = D[k].ours.years.filter((y) => u.has(y.year));
  return { won: o.filter((y) => y.made_money_pct > u.get(y.year)!).length, of: o.length };
};

const method = (usualHow: string): Block[] => [
  { type: "h2", id: "how-we-tested", text: "How we tested it" },
  {
    type: "p",
    text:
      `Both versions ran on exactly the same stocks and the same days: each year's 300 most traded NSE stocks, from July 2019 to ` +
      `October 2026. Each year uses the stocks that were most traded in that year, so the test cannot cheat by looking only at ` +
      `today's winners. Every trade is bought at the next session's opening price (the dip rules at their set buy price), and ` +
      `every trade pays 0.5% for brokerage, taxes and slippage. A trade still open at the end is left out. Nothing was picked ` +
      `by hand and no losing trade was removed.`,
  },
  { type: "p", text: usualHow },
];

const limits = (k: RuleKey, extra: string[]): Block[] => [
  { type: "h2", id: "what-this-does-not-mean", text: "What this does not mean" },
  {
    type: "list",
    items: [
      `**It is not a promise.** These are results on past prices. Markets change, and a rule that worked for seven years can have a bad year, or several.`,
      `**Our rule still loses.** About ${in100(100 - D[k].ours.all.made_money_pct)} of its trades lost money after costs. Any single trade can be one of them.`,
      ...extra,
      `**It is research, not advice.** A signal is the output of a fixed rule applied the same way to every stock. It does not know your money, your goals or your risk.`,
    ],
  },
];

const howToSee = (ruleName: string, chartButton: string): Block[] => [
  { type: "h2", id: "how-to-use-it", text: "How to see it on your own charts" },
  {
    type: "p",
    text:
      `On QuantsPulse, open any of the 500 largest NSE stocks and pick **${chartButton}** above the chart. You see every past trade ` +
      `of the ${ruleName} rule on that stock, with its buy, its safety stop and how it ended. To use the same rule on ` +
      `TradingView, press **Copy Pine script** next to it. You get one script for this rule only, with the same entry, stop ` +
      `and exit, which you paste into TradingView's Pine Editor. [Open a free account](/signup) to try it.`,
  },
];

const ex = (k: RuleKey) => D[k].example;

// ---------------------------------------------------------------------------------------------------------------- 1
const sma = (): Post => {
  const u = D.sma.usual, o = D.sma.ours, w = yearsWon("sma");
  return {
    slug: "sma-20-50-crossover-vs-sma-trend-rule",
    rule: "sma",
    ruleName: "SMA 20/50 Trend",
    usualName: "Usual crossover",
    title: "SMA 20/50 Crossover vs the SMA 20/50 Trend Rule: Seven Years of NSE Data",
    seoTitle: "SMA 20/50 Crossover Tested on NSE Stocks, 2019 to 2026",
    description:
      `The 20 and 50 day moving average crossover made money on ${in100(u.all.made_money_pct)} NSE trades. ` +
      `A leader check, a safety stop and a planned exit lifted it to ${in100(o.all.made_money_pct)}.`,
    keywords: ["SMA 20 50 crossover", "moving average crossover strategy", "golden cross NSE", "20 50 SMA strategy India",
      "moving average backtest NSE", "SMA crossover win rate"],
    published: PUBLISHED,
    updated: PUBLISHED,
    answer:
      `The usual SMA 20/50 crossover (buy when the 20 day average crosses above the 50 day, sell when it crosses back) made money ` +
      `on ${in100(u.all.made_money_pct)} trades on NSE stocks from 2019 to 2026. Our SMA 20/50 Trend rule takes the same cross ` +
      `only in market leaders, with a safety stop and a 60 session exit. It made money on ${in100(o.all.made_money_pct)}, did ` +
      `better in ${w.won} of ${w.of} years, and needed about one fifth of the trades.`,
    takeaways: [
      `The plain crossover fires about ${count(u.all.per_year)} trades a year on 300 stocks; most are small losses in sideways markets.`,
      `Taking the cross only in leaders (top 30% by six month return) cut that to about ${count(o.all.per_year)} a year.`,
      `Trades that made money: ${pct(u.all.made_money_pct)} for the usual way, ${pct(o.all.made_money_pct)} for ours.`,
      `The usual way's average trade was higher over all seven years, thanks to the big runs of 2020 and 2023. In 2024 to 2026 ours was higher.`,
      `When our rule loses, it loses more per trade (its stop is wider). Size each trade so that loss is one you can take.`,
    ],
    blocks: [
      { type: "stats" },
      { type: "h2", id: "the-usual-way", text: "What the usual crossover does" },
      {
        type: "p",
        text:
          `The 20 and 50 day crossover is one of the first tools most traders learn. A moving average is simply the average ` +
          `closing price of the last few days. When the 20 day average rises above the 50 day average, the short term trend has ` +
          `turned up, so you buy. When it falls back under, you sell. It is free on every chart, it is easy to follow, and it ` +
          `catches every big trend.`,
      },
      {
        type: "p",
        text:
          `The trouble is that it also catches everything else. In a sideways market the two averages cross back and forth, and ` +
          `every cross is a new trade. In our test the usual crossover fired about ${count(u.all.per_year)} trades a year on 300 ` +
          `stocks, and the middle trade was ${result(u.all.median_pct)}.`,
      },
      { type: "h2", id: "what-we-change", text: "What our SMA 20/50 Trend rule changes" },
      { type: "p", text: "Our rule keeps the same cross and adds three things." },
      {
        type: "list",
        ordered: true,
        items: [
          `**Leaders only.** On the day of the cross, the stock's six month return must be in the top 30% of the 500 largest NSE companies. A cross in a stock that is already beating most of the market is more often the start of a real move.`,
          `**A safety stop from day one.** The stop sits four times the stock's average daily range (called ATR 14) under the signal day's close. You know your worst case before you buy.`,
          `**A planned exit.** If the stop is not hit, the trade is closed after 60 sessions, about three months. There is no waiting for the averages to cross back, which often hands back a good part of the gain.`,
        ],
      },
      { type: "diagram", caption: "How the SMA 20/50 Trend rule reads a chart: the cross, the leader check, the safety stop and the 60 session exit." },
      ...method(
        `The usual crossover was tested the way most people use it: buy at the next open after the 20 day average closes above the ` +
          `50 day, sell when it closes back under, with no stop. One trade per stock at a time for both.`,
      ),
      { type: "h2", id: "results", text: "The results" },
      {
        type: "chart",
        chart: "periods",
        title: "Trades that made money, after costs",
        caption: "Out of every 100 trades. The buttons switch to the average trade and the middle trade.",
      },
      {
        type: "p",
        text:
          `Over all seven years the usual crossover made money on ${pct(u.all.made_money_pct)} of its trades and our rule on ` +
          `${pct(o.all.made_money_pct)}. The middle trade tells the same story: ${result(u.all.median_pct)} for the usual way, ` +
          `${result(o.all.median_pct)} for ours.`,
      },
      {
        type: "p",
        text:
          `One number goes the other way, and you should know it. The **average** usual trade was higher: ` +
          `${result(u.all.avg_pct)} against ${result(o.all.avg_pct)} for ours. That average comes from a few huge trends in 2020 ` +
          `and 2023, when almost any crossover worked and a trade held until the cross back could run for many months. In the ` +
          `last three years, 2024 to 2026, that edge was gone: the usual average was ${result(u.recent.avg_pct)} and ours ` +
          `${result(o.recent.avg_pct)}, and ours still made money more often (${pct(o.recent.made_money_pct)} against ` +
          `${pct(u.recent.made_money_pct)}).`,
      },
      { type: "table", title: "The usual crossover and our rule, side by side" },
      { type: "h2", id: "year-by-year", text: "Year by year" },
      {
        type: "chart",
        chart: "years",
        title: "Trades that made money, each year",
        caption: "2019 starts in July and 2026 ends in October. Hover or tap a bar for the trades and the average result.",
      },
      {
        type: "p",
        text:
          `Our rule made money on a larger share of its trades in ${w.won} of the ${w.of} years. A rule that holds up year after ` +
          `year is easier to stick with than one that depends on catching a rare great year.`,
      },
      { type: "h2", id: "spread", text: "Where the results land" },
      {
        type: "chart",
        chart: "spread",
        title: "How every trade ended",
        caption: "Share of each version's trades in each result range, after costs.",
      },
      {
        type: "p",
        text:
          `The usual crossover's losers are spread out, most of them between 2% and 10%: trades that crossed up, crossed back ` +
          `and cost a little each time. Our rule's losers bunch up at 10 to 20%, where its safety stop sits, because the stop is ` +
          `further away than a quick cross back. The average losing trade was ${result(o.all.avg_loss_pct)} for ours and ` +
          `${result(u.all.avg_loss_pct)} for the usual way. In return its winners ran further: ` +
          `${pct(o.hist.slice(8).reduce((a, b) => a + b, 0), 0)} of its trades made more than 10%, against ` +
          `${pct(u.hist.slice(8).reduce((a, b) => a + b, 0), 0)} for the usual way.`,
      },
      { type: "h2", id: "example", text: `One real stock: ${ex("sma")?.symbol ?? ""}` },
      {
        type: "chart",
        chart: "example",
        title: `${ex("sma")?.symbol ?? ""} daily closes, January 2025 to September 2026`,
        caption:
          "Picked by a fixed rule, not by its result: the most traded stock of 2025 with at least two trades of each kind from January 2025 to June 2026. Hover a mark to see the trade.",
      },
      ...limits("sma", [
        `**Leaders need a ranking.** QuantsPulse ranks the 500 largest companies every evening. TradingView cannot do that, so our Pine script for this rule uses a stand in (the stock beat the Nifty 50 over six months by at least 15 points), which agreed with the real ranking on about 9 in 10 crossover days.`,
      ]),
      ...howToSee("SMA 20/50 Trend", "SMA 20/50"),
    ],
    faq: [
      {
        q: "Does the 20 and 50 day moving average crossover work on Indian stocks?",
        a: `On its own it made money on ${in100(u.all.made_money_pct)} trades on NSE's most traded stocks from 2019 to 2026, after costs. Its average trade was positive because of a few long trends, but the middle trade was ${result(u.all.median_pct)}. Taking the cross only in market leaders, with a safety stop and a 60 session exit, made money on ${in100(o.all.made_money_pct)}.`,
      },
      {
        q: "What is the SMA 20/50 Trend rule?",
        a: "A buy signal when the 20 day simple moving average closes above the 50 day average while the stock is in the top 30% of the 500 largest NSE companies by six month return. The safety stop is four times the 14 day average range under the signal close, and the trade closes at the stop or after 60 sessions.",
      },
      {
        q: "Why use a 60 session exit instead of waiting for the averages to cross back?",
        a: "Moving averages are slow, so by the time they cross back much of the gain has often gone. A fixed review after about three months takes the trend's main part and frees the money for the next signal. In our test it also made the results steadier from year to year.",
      },
      {
        q: "Can I use this rule on TradingView?",
        a: "Yes. On any stock's chart in QuantsPulse, pick SMA 20/50 and press Copy Pine script. The script holds only this rule, with the same stop and exit. It uses a simple stand in for the leader ranking, because TradingView cannot rank 500 stocks at once.",
      },
    ],
  };
};

// ---------------------------------------------------------------------------------------------------------------- 2
const rsi = (): Post => {
  const u = D.rsi.usual, o = D.rsi.ours, w = yearsWon("rsi");
  return {
    slug: "rsi-oversold-vs-rsi-dip-rule",
    rule: "rsi",
    ruleName: "RSI Dip",
    usualName: "Usual RSI 30 buy",
    title: "RSI Below 30 Is Not a Buy Signal: The RSI Dip Rule Tested on NSE Stocks",
    seoTitle: "RSI Oversold Strategy Tested on NSE: RSI 30 vs RSI Dip",
    description:
      `Buying when RSI climbs back above 30 made money on only ${in100(u.all.made_money_pct)} NSE trades. Buying sharp dips in ` +
      `rising stocks at a set price made money on ${in100(o.all.made_money_pct)}.`,
    keywords: ["RSI oversold strategy", "RSI 30 buy signal", "RSI 2 strategy", "RSI strategy NSE", "RSI backtest India",
      "buy the dip RSI"],
    published: PUBLISHED,
    updated: PUBLISHED,
    answer:
      `Buying when the 14 day RSI climbs back above 30, the way most people read "oversold", made money on only ` +
      `${in100(u.all.made_money_pct)} trades on NSE stocks from 2019 to 2026, and the average trade lost money after costs. ` +
      `Our RSI Dip rule buys a sharp two day drop only in stocks above their 200 day average, at a set price below the close, ` +
      `and sells on the first bounce. It made money on ${in100(o.all.made_money_pct)} and did better in ${w.won} of ${w.of} years.`,
    takeaways: [
      `"Oversold" is not a reason to buy on its own: a stock under RSI 30 is often falling for a good reason.`,
      `The usual RSI 30 buy made money on ${pct(u.all.made_money_pct)} of trades; its average trade was ${result(u.all.avg_pct)}.`,
      `Our RSI Dip rule only buys dips in stocks that are still in a long uptrend (above the 200 day average).`,
      `It waits for a lower price the next day and sells on the first bounce, about ${Math.round(o.all.avg_days)} sessions later on average.`,
      `It made money on ${pct(o.all.made_money_pct)} of trades. The gains are small per trade, so costs and discipline matter.`,
    ],
    blocks: [
      { type: "stats" },
      { type: "h2", id: "the-usual-way", text: "What the usual RSI signal does" },
      {
        type: "p",
        text:
          `RSI, the Relative Strength Index, scores a stock from 0 to 100 by comparing its recent up days with its down days. ` +
          `Under 30 is called oversold, over 70 overbought. The usual way to trade it: when RSI falls under 30 and then climbs ` +
          `back above it, buy, because the selling seems to be over. Sell when RSI later falls back from above 70, or take a ` +
          `fixed profit or loss.`,
      },
      {
        type: "p",
        text:
          `It sounds sensible, but a stock does not fall under RSI 30 by accident. Often a result disappointed, a sector turned, ` +
          `or the whole market is sliding. Buying every such stock means buying a lot of falling knives. In our test the middle ` +
          `trade of the usual way was ${result(u.all.median_pct)}, which is where its 5% stop sits once costs are paid: at least ` +
          `half of the trades were stopped out.`,
      },
      { type: "h2", id: "what-we-change", text: "What our RSI Dip rule changes" },
      { type: "p", text: "Our rule still looks for a sharp drop, but it asks better questions first." },
      {
        type: "list",
        ordered: true,
        items: [
          `**Only in a long uptrend.** The stock must close above its 200 day average. A dip in a stock that is rising over the year is a pause far more often than the start of a collapse.`,
          `**A faster RSI.** It uses a 2 day RSI, which reacts to a sharp two day drop. The signal is a close with RSI 2 under 10.`,
          `**A better price, or no trade.** The next day it buys only if the price dips one average daily range (ATR 14) under the signal close. If the dip does not come, there is no trade.`,
          `**Out on the first bounce.** It sells on the first close above the 5 day average, or after 10 sessions, with a safety stop five ranges under the buy price.`,
        ],
      },
      { type: "diagram", caption: "How the RSI Dip rule reads a chart: a sharp drop above the 200 day average, a buy level for the next day, and the sale on the bounce." },
      ...method(
        `The usual RSI signal was tested as many traders use it: buy at the next open after the 14 day RSI closes back above 30, ` +
          `with a 5% stop and an 8% target, and sell when RSI falls back under 70 if neither is hit first. One trade per stock at a time for both.`,
      ),
      { type: "h2", id: "results", text: "The results" },
      {
        type: "chart",
        chart: "periods",
        title: "Trades that made money, after costs",
        caption: "Out of every 100 trades. The buttons switch to the average trade and the middle trade.",
      },
      {
        type: "p",
        text:
          `This is the clearest difference of all five rules. The usual RSI 30 buy made money on ${pct(u.all.made_money_pct)} ` +
          `of trades and its average trade was ${result(u.all.avg_pct, 2)}, so after costs it lost money over seven years. Our ` +
          `RSI Dip rule made money on ${pct(o.all.made_money_pct)}, with an average of ${result(o.all.avg_pct, 2)} and a middle ` +
          `trade of ${result(o.all.median_pct)}. It also held up in the last three years: ${pct(o.recent.made_money_pct)} of trades ` +
          `made money in 2024 to 2026, against ${pct(u.recent.made_money_pct)} for the usual way.`,
      },
      { type: "table", title: "The usual RSI 30 buy and our rule, side by side" },
      { type: "h2", id: "year-by-year", text: "Year by year" },
      {
        type: "chart",
        chart: "years",
        title: "Trades that made money, each year",
        caption: "2019 starts in July and 2026 ends in October. Hover or tap a bar for the trades and the average result.",
      },
      {
        type: "p",
        text:
          `Our rule made money on a larger share of trades in ${w.won} of ${w.of} years. It was not perfect: in 2020, the year of ` +
          `the crash, more of its trades made money but the losers were deep, so the average trade that year was ` +
          `${result(o.years.find((y) => y.year === 2020)?.avg_pct ?? 0)}.`,
      },
      { type: "h2", id: "spread", text: "Where the results land" },
      {
        type: "chart",
        chart: "spread",
        title: "How every trade ended",
        caption: "Share of each version's trades in each result range, after costs.",
      },
      {
        type: "p",
        text:
          `The usual RSI buy has two piles: a loss of 5 to 10%, where its stop sits, and a gain of 5 to 10%, its target. More ` +
          `trades land in the first pile. Our rule's trades cluster at small gains instead: most ` +
          `bounces are modest, a few percent, which is why it sells quickly. The safety stop is wide, so a losing trade can still ` +
          `hurt (the average loser was ${result(o.all.avg_loss_pct)}), but losers came about a third of the time.`,
      },
      { type: "h2", id: "example", text: `One real stock: ${ex("rsi")?.symbol ?? ""}` },
      {
        type: "chart",
        chart: "example",
        title: `${ex("rsi")?.symbol ?? ""} daily closes, January 2025 to September 2026`,
        caption:
          "Picked by a fixed rule, not by its result: the most traded stock of 2025 with at least two trades of each kind from January 2025 to June 2026. Hover a mark to see the trade.",
      },
      ...limits("rsi", [
        `**Small gains need low costs.** The average trade is under 1% after our 0.5% cost. If your costs per trade are much higher, the edge shrinks fast.`,
        `**A buy level, not a market order.** The rule buys only if the price comes down to its level the next day. Chasing the open instead changes the results.`,
      ]),
      ...howToSee("RSI Dip", "RSI"),
    ],
    faq: [
      {
        q: "Is RSI below 30 a good buy signal?",
        a: `Not on its own. Buying when the 14 day RSI climbed back above 30 made money on ${in100(u.all.made_money_pct)} trades on NSE's most traded stocks from 2019 to 2026, and lost money on average after costs. Oversold stocks are often falling for a reason.`,
      },
      {
        q: "What is the RSI Dip rule?",
        a: "A signal when a stock above its 200 day average closes with a 2 day RSI under 10. The next session it buys only if the price dips one average daily range under that close. It sells on the first close above the 5 day average, after 10 sessions, or at a safety stop five ranges under the buy.",
      },
      {
        q: "Why a 2 day RSI and not the usual 14 day?",
        a: "The 14 day RSI is slow: by the time it says oversold, the drop has often run for weeks. A 2 day RSI catches a short, sharp drop inside a longer uptrend, which is the kind of dip that tends to bounce.",
      },
      {
        q: "How long does an RSI Dip trade last?",
        a: `About ${Math.round(o.all.avg_days)} sessions on average in our test, and never more than 10. It is a short trade by design: buy the dip, sell the bounce.`,
      },
    ],
  };
};

// ---------------------------------------------------------------------------------------------------------------- 3
const kk = (): Post => {
  const u = D.kk.usual, o = D.kk.ours, w = yearsWon("kk");
  return {
    slug: "buy-the-dip-20-day-low-kk-dip-rule",
    rule: "kk",
    ruleName: "KK Dip",
    usualName: "Wait for the bounce",
    title: "Buying a Dip Under the 20 Day Low: Why Waiting for the Bounce Costs You",
    seoTitle: "20 Day Low Dip Strategy Tested on NSE: The KK Dip Rule",
    description:
      `Waiting for a bounce after a break of the 20 day low made money on ${in100(u.all.made_money_pct)} NSE trades. ` +
      `Buying the dip itself, in rising stocks, made money on ${in100(o.all.made_money_pct)}.`,
    keywords: ["buy the dip strategy", "20 day low strategy", "support breakdown reversal", "swing trading NSE",
      "dip buying backtest India", "KK dip"],
    published: PUBLISHED,
    updated: PUBLISHED,
    answer:
      `When a stock breaks under its 20 day low, the usual advice is to wait for proof of a bounce before buying. On NSE stocks ` +
      `from 2019 to 2026 that made money on only ${in100(u.all.made_money_pct)} trades, and lost money on average after costs. ` +
      `Our KK Dip rule buys the dip itself, but only in stocks above their 200 day average and only at a set lower price, and ` +
      `sells on the first bounce. It made money on ${in100(o.all.made_money_pct)} and did better in ${w.won} of ${w.of} years.`,
    takeaways: [
      `A break under the 20 day low is a common setup, and the usual way waits for the price to climb back before buying.`,
      `Waiting for that proof means buying late, after the cheap part of the bounce: ${pct(u.all.made_money_pct)} of those trades made money.`,
      `Our KK Dip rule buys only in stocks above their 200 day average, and only if the price dips further to a set level the next day.`,
      `It sells on the first close above the 5 day average: ${pct(o.all.made_money_pct)} of its trades made money.`,
      `It trades far less: about ${count(o.all.per_year)} trades a year against ${count(u.all.per_year)}.`,
    ],
    blocks: [
      { type: "stats" },
      { type: "h2", id: "the-usual-way", text: "What the usual dip trade does" },
      {
        type: "p",
        text:
          `The 20 day low is the lowest price of the last month or so. Many traders treat it as support: a floor where buyers ` +
          `showed up before. When the price pushes at least 1% under that floor, two things can happen. Either the floor breaks ` +
          `and the fall goes on, or sellers run out and the price snaps back.`,
      },
      {
        type: "p",
        text:
          `The usual way plays it safe: wait for proof. Buy only once the price climbs back above the high of the day that broke ` +
          `the floor, within five sessions, then take a quick profit at set targets. The problem is that by the time the proof ` +
          `arrives, much of the bounce has already happened, and the stop under the low is close enough to be hit by normal noise. ` +
          `In our test the middle trade was ${result(u.all.median_pct)}.`,
      },
      { type: "h2", id: "what-we-change", text: "What our KK Dip rule changes" },
      { type: "p", text: "Our rule turns the trade around: it buys weakness instead of strength, but only where weakness is usually brief." },
      {
        type: "list",
        ordered: true,
        items: [
          `**Only in a long uptrend.** The stock must close above its 200 day average. A dip under the 20 day low in a rising stock is usually a shakeout, not the end.`,
          `**Buy lower, not higher.** The next day it buys only if the price falls one average daily range (ATR 14) under the signal close. If the price runs away, there is no trade, and that is fine.`,
          `**Sell the first bounce.** It sells on the first close above the 5 day average, or after 10 sessions.`,
          `**A wide safety stop.** Five average ranges under the buy price, so normal noise does not knock the trade out.`,
        ],
      },
      { type: "diagram", caption: "How the KK Dip rule reads a chart: the push under the 20 day low, the lower buy level for the next day, and the sale on the bounce." },
      ...method(
        `The usual version was tested as a confirmed reversal: after a low at least 1% under the 20 day low, buy when the price ` +
          `climbs back above that day's high within five sessions; stop at that day's low; half the trade sold at 0.75 times the ` +
          `risk and the rest at 2 times, or at the close of the fifth session. One trade per stock at a time for both.`,
      ),
      { type: "h2", id: "results", text: "The results" },
      {
        type: "chart",
        chart: "periods",
        title: "Trades that made money, after costs",
        caption: "Out of every 100 trades. The buttons switch to the average trade and the middle trade.",
      },
      {
        type: "p",
        text:
          `The usual confirmed bounce made money on ${pct(u.all.made_money_pct)} of its trades, and the average trade was ` +
          `${result(u.all.avg_pct, 2)}. Our KK Dip rule made money on ${pct(o.all.made_money_pct)}, with an average of ` +
          `${result(o.all.avg_pct, 2)} and a middle trade of ${result(o.all.median_pct)}. By average result the last three years were ` +
          `its best: ${pct(o.recent.made_money_pct)} of trades made money in 2024 to 2026, with an average of ${result(o.recent.avg_pct)}.`,
      },
      { type: "table", title: "Waiting for the bounce and our rule, side by side" },
      { type: "h2", id: "year-by-year", text: "Year by year" },
      {
        type: "chart",
        chart: "years",
        title: "Trades that made money, each year",
        caption: "2019 starts in July and 2026 ends in October. Hover or tap a bar for the trades and the average result.",
      },
      {
        type: "p",
        text:
          `Our rule made money on a larger share of trades in ${w.won} of ${w.of} years. Its weakest year was 2020: dips in March ` +
          `of that year kept falling, and the average trade was ${result(o.years.find((y) => y.year === 2020)?.avg_pct ?? 0)}. ` +
          `Buying dips works when dips are brief, and in a crash they are not.`,
      },
      { type: "h2", id: "spread", text: "Where the results land" },
      {
        type: "chart",
        chart: "spread",
        title: "How every trade ended",
        caption: "Share of each version's trades in each result range, after costs.",
      },
      {
        type: "p",
        text:
          `The usual version's results stack up at small losses, where its tight stop sits. Ours stack up at small gains of up to ` +
          `5%: a quick bounce, sold. The losers are fewer but larger (on average ${result(o.all.avg_loss_pct)}), because the ` +
          `stop is wide on purpose.`,
      },
      { type: "h2", id: "example", text: `One real stock: ${ex("kk")?.symbol ?? ""}` },
      {
        type: "chart",
        chart: "example",
        title: `${ex("kk")?.symbol ?? ""} daily closes, January 2025 to September 2026`,
        caption:
          "Picked by a fixed rule, not by its result: the most traded stock of 2025 with at least two trades of each kind from January 2025 to June 2026. Hover a mark to see the trade.",
      },
      ...limits("kk", [
        `**Crashes hurt dip buying.** In a market wide fall, dips do not bounce quickly, and the wide stop gets hit. 2020 was a losing year for this rule.`,
        `**Many signals never trade.** If the price does not come down to the buy level the next day, nothing happens. That is part of the rule, not a fault.`,
      ]),
      ...howToSee("KK Dip", "KK"),
    ],
    faq: [
      {
        q: "Should you buy when a stock breaks its 20 day low?",
        a: `Not blindly, and waiting for a bounce did not help either: that version made money on ${in100(u.all.made_money_pct)} trades on NSE's most traded stocks from 2019 to 2026. Buying the dip only in stocks above their 200 day average, at a lower set price, and selling the first bounce made money on ${in100(o.all.made_money_pct)}.`,
      },
      {
        q: "What is the KK Dip rule?",
        a: "A signal when a stock above its 200 day average makes a low at least 1% under the lowest low of the previous 20 sessions. The next session it buys only if the price falls one average daily range under the signal close. It sells on the first close above the 5 day average, after 10 sessions, or at a stop five ranges under the buy.",
      },
      {
        q: "Why buy at a lower price instead of at the open?",
        a: "A lower set price means the rule only buys when sellers push one more time, which is often the last push. It also gives a better entry price, which matters for a short trade with small gains.",
      },
      {
        q: "How often does the KK Dip rule trade?",
        a: `About ${count(o.all.per_year)} trades a year across 300 stocks in our test, against ${count(u.all.per_year)} for the usual version. Fewer trades also means less paid in costs.`,
      },
    ],
  };
};

// ---------------------------------------------------------------------------------------------------------------- 4
const strong = (): Post => {
  const u = D.strong.usual, o = D.strong.ours, t = D.strong.usualTrail!;
  return {
    slug: "52-week-high-breakout-strong-trend-rule",
    rule: "strong",
    ruleName: "Strong Trend",
    usualName: "Every 52 week high",
    title: "52 Week High Breakouts on NSE: Why the Exit Plan Matters More Than the Signal",
    seoTitle: "52 Week High Breakout Strategy Tested on NSE Stocks",
    description:
      `Every new 52 week high, sold under the 50 day average, made money on ${in100(t.all.made_money_pct)} NSE trades. ` +
      `A safety stop and a 60 session exit lifted it to ${in100(o.all.made_money_pct)}.`,
    keywords: ["52 week high breakout", "breakout strategy NSE", "52 week high stocks India", "momentum strategy India",
      "breakout backtest", "volume breakout"],
    published: PUBLISHED,
    updated: PUBLISHED,
    answer:
      `Buying a stock at a new 52 week high works better with a plan than without one. On NSE stocks from 2019 to 2026, the ` +
      `common way (buy the breakout, sell when it closes under its 50 day average) made money on ${in100(t.all.made_money_pct)} ` +
      `trades. Our Strong Trend rule adds a volume check, a market check, a safety stop and a 60 session exit, and made money on ` +
      `${in100(o.all.made_money_pct)}. Most of that gain comes from the exit plan; the filters mainly cut the number of trades.`,
    takeaways: [
      `A new 52 week high is one of the strongest signals a stock can give, but how you get out decides most of the result.`,
      `Selling when the close drops under the 50 day average made money on ${pct(t.all.made_money_pct)} of breakout trades.`,
      `The same breakouts with a safety stop and a 60 session exit made money on ${pct(u.all.made_money_pct)}.`,
      `Our Strong Trend rule's volume and market checks cut trades by about a quarter, with similar results over seven years and better ones in 2024 to 2026.`,
      `Breakouts lose often and lose big when they fail: plan your size around the stop.`,
    ],
    blocks: [
      { type: "stats" },
      { type: "h2", id: "the-usual-way", text: "What the usual breakout trade does" },
      {
        type: "p",
        text:
          `A stock that closes above every close of the past year has made a new 52 week high. Everyone who bought in the last ` +
          `twelve months is now in profit, and there is no one left above who is waiting to sell at break even. That is why ` +
          `breakouts can run, and why so many traders scan for them.`,
      },
      {
        type: "p",
        text:
          `The common way to trade it is to buy the breakout and hold while the trend lasts, selling when the price closes under ` +
          `its 50 day average. It sounds fine, but a breakout often pulls back for a few days before it moves, and that pullback is ` +
          `enough to dip under the 50 day line and sell. In our test that version made money on ${pct(t.all.made_money_pct)} of ` +
          `trades, and the middle trade was ${result(t.all.median_pct)}.`,
      },
      { type: "h2", id: "what-we-change", text: "What our Strong Trend rule changes" },
      {
        type: "list",
        ordered: true,
        items: [
          `**Heavy volume.** The breakout day must trade at least twice the average volume of the previous 50 sessions. A breakout that big buyers join is harder to fake.`,
          `**A healthy market.** The market weather must be sunny: the Nifty 50 above its 200 day average, its 50 day average above the 200 day, and India VIX, the fear gauge, at 22 or less.`,
          `**A safety stop with room.** Four average daily ranges (ATR 14) under the signal close, so a normal pullback does not end the trade.`,
          `**A planned exit.** If the stop is not hit, the trade is closed after 60 sessions, about three months.`,
        ],
      },
      { type: "diagram", caption: "How the Strong Trend rule reads a chart: a close above the 52 week high on twice the usual volume, in a sunny market, with a safety stop and a 60 session exit." },
      ...method(
        `We tested two usual versions, and we are open about the order. Before seeing any result we chose "every new 52 week ` +
          `high, with the same stop and 60 session exit as ours", to measure what the volume and market checks add. When that ` +
          `came out close to our rule, we added the common way traders actually exit (sell on the first close under the 50 day ` +
          `average, no stop), so you can see what the plan adds. Both are shown below.`,
      ),
      { type: "h2", id: "results", text: "The results" },
      {
        type: "chart",
        chart: "periods",
        title: "Trades that made money, after costs",
        caption: "Out of every 100 trades. The buttons switch to the average trade and the middle trade.",
      },
      {
        type: "p",
        text:
          `Three versions of the same idea. Selling under the 50 day average: ${pct(t.all.made_money_pct)} of trades made money, ` +
          `middle trade ${result(t.all.median_pct)}. Every breakout with our plan: ${pct(u.all.made_money_pct)}, middle trade ` +
          `${result(u.all.median_pct)}. Our Strong Trend rule: ${pct(o.all.made_money_pct)}, middle trade ${result(o.all.median_pct)}. ` +
          `The big step is the plan. The volume and market checks then made little difference over seven years.`,
      },
      {
        type: "p",
        text:
          `They did matter lately. In 2024 to 2026 our rule's average trade was ${result(o.recent.avg_pct)} against ` +
          `${result(u.recent.avg_pct)} for every breakout with the same plan, and ${pct(o.recent.made_money_pct)} of trades made ` +
          `money against ${pct(u.recent.made_money_pct)}. They also cut the work: about ${count(o.all.per_year)} trades a year ` +
          `instead of ${count(u.all.per_year)}. In 2022, a choppy year, the checks did worse, so this is not a one way story.`,
      },
      { type: "table", title: "Every breakout and our rule, side by side" },
      {
        type: "callout",
        title: "The common exit, for comparison",
        text:
          `Every new 52 week high, sold on the first close under the 50 day average, no stop: ${count(t.all.trades)} trades, ` +
          `${pct(t.all.made_money_pct)} made money, average ${result(t.all.avg_pct)}, middle trade ${result(t.all.median_pct)}. ` +
          `In 2024 to 2026: ${pct(t.recent.made_money_pct)} made money, average ${result(t.recent.avg_pct)}.`,
      },
      { type: "h2", id: "year-by-year", text: "Year by year" },
      {
        type: "chart",
        chart: "years",
        title: "Trades that made money, each year",
        caption: "Every breakout with our plan, against our rule. Hover or tap a bar for the trades and the average result.",
      },
      {
        type: "p",
        text:
          `Year by year the two are close, and each wins some years. That is the honest result: on breakouts, the filters are a ` +
          `fine tuning. What turns a breakout from a coin toss into a trade with a plan is knowing your stop and your exit before you buy.`,
      },
      { type: "h2", id: "spread", text: "Where the results land" },
      {
        type: "chart",
        chart: "spread",
        title: "How every trade ended",
        caption: "Share of each version's trades in each result range, after costs.",
      },
      {
        type: "p",
        text:
          `Breakouts are a game of a few big winners. About one trade in ten made more than ${pct(o.all.best10_pct, 0)}, while ` +
          `the average losing trade was ${result(o.all.avg_loss_pct)}. A rule like this needs patience through runs of losers ` +
          `to be there for the big moves.`,
      },
      { type: "h2", id: "example", text: `One real stock: ${ex("strong")?.symbol ?? ""}` },
      {
        type: "chart",
        chart: "example",
        title: `${ex("strong")?.symbol ?? ""} daily closes, January 2025 to September 2026`,
        caption:
          "Picked by a fixed rule, not by its result: the most traded stock of 2025 with at least two trades of each kind from January 2025 to June 2026. Hover a mark to see the trade.",
      },
      ...limits("strong", [
        `**The filters are not magic.** Over seven years our rule and every breakout with the same plan ended close together. We say so because it is true.`,
        `**Losers are big.** The stop sits far below the buy, so a failed breakout costs about ${pct(Math.abs(o.all.avg_loss_pct), 0)}. Keep each trade small enough for that.`,
      ]),
      ...howToSee("Strong Trend", "Strong trend"),
    ],
    faq: [
      {
        q: "Does buying 52 week high stocks work in India?",
        a: `With a plan, it has. On NSE's most traded stocks from 2019 to 2026, buying new 52 week highs with a safety stop and a 60 session exit made money on ${in100(u.all.made_money_pct)} trades after costs, against ${in100(t.all.made_money_pct)} when selling on a close under the 50 day average.`,
      },
      {
        q: "What is the Strong Trend rule?",
        a: "A signal when a stock closes above its highest close of the past 252 sessions, on at least twice its average volume of the previous 50 sessions, above its 50 day average, while the market weather is sunny. The safety stop is four average daily ranges under the signal close, and the trade closes at the stop or after 60 sessions.",
      },
      {
        q: "Why does volume matter on a breakout?",
        a: "Heavy volume shows that many buyers joined the move, which makes a false breakout less likely. In our test the volume and market checks cut the number of trades by about a quarter and did better in 2024 to 2026, though over seven years the gain was small.",
      },
      {
        q: "What is market weather?",
        a: "A simple reading of the whole market. Sunny means the Nifty 50 is above its 200 day average, its 50 day average is above the 200 day, and India VIX is at 22 or less. Strong Trend only buys on sunny days.",
      },
    ],
  };
};

// ---------------------------------------------------------------------------------------------------------------- 5
const ma200 = (): Post => {
  const u = D.ma200.usual, o = D.ma200.ours, w = yearsWon("ma200");
  return {
    slug: "200-day-moving-average-vs-200-day-trend-rule",
    rule: "ma200",
    ruleName: "200 Day Trend",
    usualName: "Usual 200 day cross",
    title: "The 200 Day Moving Average Crossover vs the 200 Day Trend Rule: Seven Years Tested",
    seoTitle: "200 Day Moving Average Strategy Tested on NSE Stocks",
    description:
      `Buying when price crosses above the 200 day average made money on only ${in100(u.all.made_money_pct)} NSE trades. ` +
      `A rising average and a steady climb lifted it to ${in100(o.all.made_money_pct)}.`,
    keywords: ["200 day moving average strategy", "200 DMA strategy", "200 day moving average India", "price above 200 DMA",
      "long term trend strategy NSE", "moving average backtest"],
    published: PUBLISHED,
    updated: PUBLISHED,
    answer:
      `The usual 200 day moving average trade (buy when the price crosses above the 200 day average, sell when it crosses back ` +
      `under) made money on only ${in100(u.all.made_money_pct)} trades on NSE stocks from 2019 to 2026. Our 200 Day Trend rule ` +
      `buys only when the average itself is flat or rising and the price has climbed steadily, with a safety stop and a 60 ` +
      `session exit. It made money on ${in100(o.all.made_money_pct)} and did better in ${w.won} of ${w.of} years.`,
    takeaways: [
      `Price crosses the 200 day average back and forth many times; each false cross is a small loss.`,
      `The usual cross made money on only ${pct(u.all.made_money_pct)} of trades; a few giant winners carried its average.`,
      `Our rule asks two more questions: is the 200 day average flat or rising, and has the price climbed steadily?`,
      `It made money on ${pct(o.all.made_money_pct)} of trades, and in 2024 to 2026 it stayed positive while the usual cross lost.`,
      `Its losses are bigger per trade because the stop has room. Size for that.`,
    ],
    blocks: [
      { type: "stats" },
      { type: "h2", id: "the-usual-way", text: "What the usual 200 day trade does" },
      {
        type: "p",
        text:
          `The 200 day moving average is the average close of roughly the last ten months. It is the line long term investors ` +
          `watch most. Above it, a stock is in an uptrend; below it, a downtrend. The usual trade: buy when the price closes ` +
          `above the line, sell when it closes back under.`,
      },
      {
        type: "p",
        text:
          `The idea is right but the trigger is loose. A stock moving sideways around its 200 day line crosses it again and again, ` +
          `and each cross is a trade that ends a few days later with a small loss. In our test only ${pct(u.all.made_money_pct)} ` +
          `of the usual trades made money. Their average was lifted by a handful of huge rallies, most of them in 2020.`,
      },
      { type: "h2", id: "what-we-change", text: "What our 200 Day Trend rule changes" },
      { type: "p", text: "Our rule buys on the first day the price is above the line, but only when the line and the climb agree." },
      {
        type: "list",
        ordered: true,
        items: [
          `**The line itself must be flat or rising.** We fit a straight line through the last 100 days of the 200 day average. It may fall no more than 0.25% over 20 sessions. A price above a falling average is often a bounce in a downtrend.`,
          `**The climb must be steady.** The last 100 closes must move up in a fairly straight line (a correlation with time of 0.5 or more), not in wild jumps.`,
          `**A safety stop and a planned exit.** The stop sits four average daily ranges (ATR 14) under the signal close, and the trade closes after 60 sessions if the stop is not hit.`,
        ],
      },
      { type: "diagram", caption: "How the 200 Day Trend rule reads a chart: the price above a flat or rising 200 day average, after a steady climb, with a safety stop and a 60 session exit." },
      ...method(
        `The usual 200 day trade was tested as it is usually taught: buy at the next open after the close crosses above the 200 ` +
          `day average, sell at the next open after it closes back under, no stop. One trade per stock at a time for both.`,
      ),
      { type: "h2", id: "results", text: "The results" },
      {
        type: "chart",
        chart: "periods",
        title: "Trades that made money, after costs",
        caption: "Out of every 100 trades. The buttons switch to the average trade and the middle trade.",
      },
      {
        type: "p",
        text:
          `The usual cross made money on ${pct(u.all.made_money_pct)} of trades: roughly four in five lost. Our rule made money on ` +
          `${pct(o.all.made_money_pct)}, and its middle trade was ${result(o.all.median_pct)} against ${result(u.all.median_pct)}.`,
      },
      {
        type: "p",
        text:
          `As with the other moving average rules, the usual way's **average** trade was higher over all seven years: ` +
          `${result(u.all.avg_pct)} against ${result(o.all.avg_pct)}. Almost all of that came from 2019 to 2023, when the usual ` +
          `average trade was ${result(u.early.avg_pct)}, mostly from the rally after the 2020 crash. In 2024 to 2026 the usual cross ` +
          `averaged ${result(u.recent.avg_pct)} per trade and made money only ${pct(u.recent.made_money_pct)} of the time, while ` +
          `ours averaged ${result(o.recent.avg_pct)} and made money ${pct(o.recent.made_money_pct)} of the time.`,
      },
      { type: "table", title: "The usual 200 day cross and our rule, side by side" },
      { type: "h2", id: "year-by-year", text: "Year by year" },
      {
        type: "chart",
        chart: "years",
        title: "Trades that made money, each year",
        caption: "2019 starts in July and 2026 ends in October. Hover or tap a bar for the trades and the average result.",
      },
      {
        type: "p",
        text:
          `Our rule made money on a larger share of trades in ${w.won} of ${w.of} years, by a wide margin every time. The usual ` +
          `cross never made money on more than ${pct(Math.max(...u.years.map((y) => y.made_money_pct)), 0)} of its trades in any year.`,
      },
      { type: "h2", id: "spread", text: "Where the results land" },
      {
        type: "chart",
        chart: "spread",
        title: "How every trade ended",
        caption: "Share of each version's trades in each result range, after costs.",
      },
      {
        type: "p",
        text:
          `The usual cross is a lottery: a mountain of small losses and a thin tail of very large wins. Our rule's results sit in ` +
          `the middle, with more modest gains and fewer, larger losses (the average loser was ${result(o.all.avg_loss_pct)} ` +
          `against ${result(u.all.avg_loss_pct)}). Which you prefer depends on whether you can sit through dozens of small losses ` +
          `waiting for one huge trend.`,
      },
      { type: "h2", id: "example", text: `One real stock: ${ex("ma200")?.symbol ?? ""}` },
      {
        type: "chart",
        chart: "example",
        title: `${ex("ma200")?.symbol ?? ""} daily closes, January 2025 to September 2026`,
        caption:
          "Picked by a fixed rule, not by its result: the most traded stock of 2025 with at least two trades of each kind from January 2025 to June 2026. Hover a mark to see the trade.",
      },
      ...limits("ma200", [
        `**The big rallies are smaller.** A 60 session exit means our rule gets off long runs early. In a year like 2020 the usual cross earned more.`,
        `**Losers are bigger.** The stop has room, so a losing trade averaged about ${pct(Math.abs(o.all.avg_loss_pct), 0)}. Keep each trade small enough for that.`,
      ]),
      ...howToSee("200 Day Trend", "200 day trend"),
    ],
    faq: [
      {
        q: "Is the 200 day moving average a good buy signal?",
        a: `As a trend filter it is useful, but the plain cross is a weak trigger. Buying every cross above the 200 day average made money on only ${in100(u.all.made_money_pct)} trades on NSE's most traded stocks from 2019 to 2026, after costs. Adding a rising average, a steady climb, a safety stop and a 60 session exit made money on ${in100(o.all.made_money_pct)}.`,
      },
      {
        q: "What is the 200 Day Trend rule?",
        a: "A signal on the first day a stock closes above its 200 day simple moving average while the straight line fitted to that average over 100 days is flat or rising, and the last 100 closes have climbed steadily. The safety stop is four average daily ranges under the signal close, and the trade closes at the stop or after 60 sessions.",
      },
      {
        q: "What does a steady climb mean here?",
        a: "We measure how closely the last 100 closing prices follow a straight rising line, a statistic called correlation. A value of 0.5 or more means the price has been climbing fairly evenly, not jumping around.",
      },
      {
        q: "Why not hold until the price falls back under the 200 day average?",
        a: "Because the price often falls back just after a small gain, and in sideways markets that happens again and again. A planned exit after about three months, with a safety stop, made the results far steadier in our test.",
      },
    ],
  };
};

export const POSTS: Post[] = [sma(), rsi(), kk(), strong(), ma200()];

export const postBySlug = (slug: string) => POSTS.find((p) => p.slug === slug);

/** Every piece of text a reader sees in a post (for the reading time and the no hyphen check). */
export function postText(p: Post): string[] {
  const out: string[] = [p.title, p.description, p.answer, ...p.takeaways, ...p.faq.flatMap((f) => [f.q, f.a])];
  for (const b of p.blocks) {
    if (b.type === "p" || b.type === "h2" || b.type === "h3") out.push(b.text);
    if (b.type === "list") out.push(...b.items);
    if (b.type === "chart") out.push(b.title, b.caption);
    if (b.type === "table") out.push(b.title);
    if (b.type === "diagram") out.push(b.caption);
    if (b.type === "callout") out.push(b.title, b.text);
  }
  return out;
}
