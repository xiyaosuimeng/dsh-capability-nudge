/**
 * capability-nudge —— 能力自动提醒（2026-10-21）
 *
 * ## 为什么要有它
 * 装了 21 个插件后验证发现：工具在工具表里，但「我会不会想起来用」不自动。
 * 能力台账（tools/abil_core.json）只在**我主动跑 abil.py match** 时才生效，
 * 而大多数轮次我不会主动跑 —— 规矩拦不住「我觉得没必要」，入口拦得住。
 * 做成框架里的入口：每一步拿用户最新消息对一遍触发词，命中就注入一条短提醒。
 *
 * ## 缓存纪律（这条最重要）
 * 只在**命中**时注入；不命中时原样返回 decision，前缀一个字节都不动。
 * 同一会话同一 turn 只提醒一次（Map 按 session:turn）。
 * 所以绝大多数轮次的缓存命中率不受影响，只有"本来要调新功能"的那几步付代价。
 *
 * ## 踩过的坑（从 persona-continuity 学的，一条都不能省）
 * 1. 注入的 user 消息必须带**非空字符串 id** —— 漏了整个会话下次打不开
 * 2. content 必须是数组 [{ type: 'text', text }]
 * 3. source.kind 必须非空（这里用 "capability-nudge"）
 * 4. 返回时必须展开 decision —— startsRequestSeries 这类字段不能丢
 * 5. 不导出 Config 就不用实现 Standard Schema（resolveConfig 对缺失的 runtime.Config 直接放行）
 * 6. 触发词从 tools/abil_core.json 读（唯一事实源），读不到就静默禁用，不报错
 *
 * ## 不做什么
 * · 不调模型（纯字符串匹配，零 token）
 * · 不写任何文件
 * · 不改台账（那是 abil.py 的活）
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const SOURCE_KIND = "capability-nudge";
const CORE = process.env.DSH_ABILITY_CORE || "abil_core.json";
const MAX_RULES = 2;
// 已知的"不是用户原话"的注入来源，跳过不匹配
const INJECTED = new Set(["capability-nudge", "persona-continuity", "instruction-hint"]);

let RULES = null;

function rules() {
  if (RULES !== null) return RULES;
  try {
    const data = JSON.parse(readFileSync(CORE, "utf8"));
    RULES = (data.caps || [])
      .map((c) => ({
        name: String(c.name || ""),
        tool: String(c.tool || ""),
        note: String(c.note || "").split("。")[0],
        keys: (c.triggers || []).map((t) => String(t).toLowerCase()).filter(Boolean),
      }))
      .filter((r) => r.keys.length && r.name);
  } catch (e) {
    RULES = [];
  }
  return RULES;
}

function textOf(message) {
  const c = message && message.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => (p && p.type === "text" ? p.text || "" : "")).join("\n");
  }
  return "";
}

function pick(lastUser) {
  const q = textOf(lastUser).toLowerCase();
  if (!q || q.length > 4000) return [];
  const hits = [];
  for (const r of rules()) {
    let best = 0;
    for (const k of r.keys) {
      if (k && q.includes(k)) best = Math.max(best, k.length);
    }
    if (best) hits.push({ r, score: best });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, MAX_RULES).map((h) => h.r);
}

const nudged = new Map(); // sessionId -> turn（故意不放投影状态：投影是折叠出来的，写不进去）

export function apply(ctx) {
  ctx.on("agent/pre-step", async ({ agent, turn, step, signal }, next) => {
    const decision = await next();
    if (decision.kind === "reject" || signal?.aborted) return decision;

    const list = decision.messages || [];
    let lastUser = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!m || m.role !== "user") continue;
      const kind = m.source && m.source.kind;
      if (kind && INJECTED.has(kind)) continue;
      lastUser = m;
      break;
    }
    if (!lastUser) return decision;

    const hits = pick(lastUser);
    if (!hits.length) return decision;

    const sid = String((agent && agent.session && agent.session.id) || "");
    if (nudged.get(sid) === turn) return decision;
    nudged.set(sid, turn);

    const parts = hits.map((r) => r.name + " → " + r.tool + (r.note ? "（" + r.note + "）" : ""));
    const text =
      "〔能力提醒·自动〕这句话命中能力台账，动手前先用：\n- " +
      parts.join("\n- ") +
      '\n不确定就先跑 python tools\\abil.py match "<任务>"。';

    if (ctx.logger && ctx.logger.info) {
      ctx.logger.info("[capability-nudge] 命中 " + hits.length + " 条 → turn " + turn + "/step " + step + " 注入");
    }
    return {
      ...decision,
      messages: [
        ...list,
        {
          id: randomUUID(),
          role: "user",
          content: [{ type: "text", text }],
          source: { kind: SOURCE_KIND },
        },
      ],
    };
  });
}
