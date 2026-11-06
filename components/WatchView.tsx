"use client";

import { useEffect, useMemo, useState } from "react";
import type { Content } from "@/lib/types";
import { FUNCTIONS, TOPICS } from "@/lib/types";
import { SECTIONS, classify, daysUntil, events, fmt, fmtShort, isTx, matchesFunctions, parseDate, rel, sortDate, startOfToday, type Classified } from "@/lib/watch";

type Props = { content: Content; defaultFunctions: string[]; teaser?: boolean };

/** Filter choices are remembered per browser, like the pilot. First visit starts from the company's registered functions. */
const SAVED = "cgm-watch-filters";
const WATCH_DISCLAIMER =
  "NERC Standards Watch summarizes publicly available NERC and FERC information for awareness only and is not a compliance determination. " +
  "Confirm applicability and dates against the approved standard, its implementation plan, and your Regional Entity. U.S. effective dates shown.";
const ALL_FN: string[] = [...FUNCTIONS.gen, ...FUNCTIONS.tx];

export default function WatchView({ content, defaultFunctions, teaser = false }: Props) {
  const [fns, setFns] = useState<string[]>(defaultFunctions);
  const [topics, setTopics] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const today = startOfToday();

  useEffect(() => {
    if (teaser) return;
    try {
      const s = JSON.parse(localStorage.getItem(SAVED) || "null");
      if (s && Array.isArray(s.fns)) setFns(s.fns.filter((f: string) => ALL_FN.includes(f)));
      if (s && Array.isArray(s.topics)) setTopics(s.topics.filter((t: string) => t in TOPICS));
    } catch {}
  }, [teaser]);
  // Saved only when the viewer changes a filter, never on load.
  const choose = (nextFns: string[], nextTopics: string[]) => {
    setFns(nextFns);
    setTopics(nextTopics);
    try { localStorage.setItem(SAVED, JSON.stringify({ fns: nextFns, topics: nextTopics })); } catch {}
  };

  const all = useMemo(() => classify(content.items, today), [content.items]); // eslint-disable-line react-hooks/exhaustive-deps
  const vis = all.filter(
    (it) =>
      it.phase !== "archived" &&
      matchesFunctions(it.fn, fns) &&
      (!topics.length || topics.includes(it.topic)) &&
      (!q || `${it.std} ${it.title} ${it.what}`.toLowerCase().includes(q.toLowerCase())),
  );
  const ev = events(vis);
  const nx = ev.find((e) => daysUntil(e.d, today) > 0);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    if (el.classList.contains("card")) {
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    }
  };
  const src = (keys: string[]) =>
    keys.filter((k) => content.sources[k]).map((k, i) => {
      const s = content.sources[k];
      const name = s.t.split(",")[0];
      return (
        <span key={k}>
          {i > 0 && " · "}
          {s.u ? <a href={s.u} target="_blank" rel="noopener noreferrer">{name}</a> : name}
        </span>
      );
    });

  const card = (it: Classified, pill: string) => {
    const nextMs = (it.milestones || []).find((m) => daysUntil(m.d, today) > 0);
    const hasGen = it.fn.some((f) => !isTx(f)), hasTx = it.fn.some(isTx);
    const showGen = hasGen && (!fns.length || fns.some((f) => !isTx(f)) || !it.todoTx);
    const showTx = !!it.todoTx && (!fns.length || fns.some(isTx));
    const ms = it.phase !== "upcoming" && it.milestones.length ? [{ d: it.effective as string, l: "Standard effective" }, ...it.milestones] : it.milestones;
    return (
      <article className="card" id={it.id} key={it.id}>
        <div className="ctop">
          <div className="cid"><div className="std">{it.std}</div><div className="ctitle">{it.title}</div></div>
          <div className="cdate">
            {it.phase === "dev" ? <span className="rel">{it.stage}</span> : <>
              <span className="rel">{it.phase === "upcoming" ? "Effective" : "Effective since"}</span>
              <span className="d">{fmt(it.effective)}</span>
              <span className="rel">{rel(it.effective as string, today)}</span>
            </>}
          </div>
        </div>
        <div className="tags">
          {it.freshNews.length > 0 && <span className="pill news">Updated recently</span>}
          {it.newApproval && <span className="pill approved">New FERC approval</span>}
          <span className={`pill ${it.phase}`}>{pill}</span>
          {it.fn.map((f) => <span className="fn" key={f}>{f}</span>)}
          <span className="topic">{TOPICS[it.topic]}</span>
        </div>
        {it.freshNews.length > 0 && (
          <div className="latest">{it.freshNews.map((n, i) => <div key={i}><span className="ld">{fmt(n.d)}</span><span>{n.t}</span></div>)}</div>
        )}
        <div className="cbody">
          <div><h3>What changes</h3><p>{it.what}</p></div>
          <div><h3>What to do</h3>
            {(showGen || !showTx) && <p>{it.todoTx && hasTx && <span className="role">GO/GOP · </span>}{it.todo}</p>}
            {showTx && <p><span className="role">{it.fn.filter(isTx).join("/")} · </span>{it.todoTx}</p>}
          </div>
        </div>
        {ms.length > 0 && (
          <ul className="ms">
            {ms.map((m, i) => (
              <li key={i} className={daysUntil(m.d, today) <= 0 ? "done" : m === nextMs ? "next-up" : ""}>
                <span className="md">{fmt(m.d)}</span><span>{m.l}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="cfoot">
          <span>{it.ferc ? `FERC approved ${fmt(it.ferc)}${it.order_no ? " · " + it.order_no : ""}` : it.phase === "dev" ? "Not yet approved by FERC" : ""}</span>
          <span>{src(it.src)}</span>
        </div>
      </article>
    );
  };

  if (teaser) {
    const sample = vis.filter((i) => i.phase === "upcoming" || i.freshNews.length).slice(0, 3);
    return (
      <>
        <div className="teaser fade">{sample.map((i) => card(i, SECTIONS.find((s) => s.k === i.phase)?.pill || ""))}</div>
        <p className="muted small-note">{WATCH_DISCLAIMER}</p>
      </>
    );
  }

  const firstShown = new Date(today); firstShown.setFullYear(today.getFullYear() - 1);
  const calRows: JSX.Element[] = [];
  let yr = "", placed = false;
  ev.filter((e) => parseDate(e.d) >= firstShown).forEach((e, i) => {
    const y = e.d.slice(0, 4);
    if (!placed && daysUntil(e.d, today) > 0) {
      if (String(today.getFullYear()) !== yr) { calRows.push(<div className="yr" key={`ty${i}`}>{today.getFullYear()}</div>); yr = String(today.getFullYear()); }
      calRows.push(<div className="today" key={`t${i}`}>Today</div>); placed = true;
    }
    if (y !== yr) { calRows.push(<div className="yr" key={`y${i}`}>{y}</div>); yr = y; }
    calRows.push(
      <button type="button" key={`e${i}`} className={daysUntil(e.d, today) <= 0 ? "past" : ""} onClick={() => go(e.id)}>
        <span className="cd">{fmtShort(e.d)}</span>
        <span className="ct"><b>{e.std}</b> {e.l === "effective" ? "effective" : `· ${e.l}`}</span>
      </button>,
    );
  });
  if (calRows.length && !placed) calRows.push(<div className="today" key="t-end">Today</div>);

  const dls = content.deadlines.filter((d) => daysUntil(d.d, today) >= 0 && matchesFunctions(d.fn, fns));
  const acts = [...content.actions].sort((a, b) => sortDate(b.d).localeCompare(sortDate(a.d)) || (a.pos ?? 0) - (b.pos ?? 0)).slice(0, 14);
  const count = (k: string) => vis.filter((i) => i.phase === k).length;

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <div>
            <div className="watchname">NERC Standards Watch</div>
            <div className="eyebrow">Generation &amp; transmission · GO · GOP · TO · TOP · TP · PC</div>
            <h1>New and changing NERC standards that apply to your facilities</h1>
            <p className="lede">Reviewed by CGM Consulting Group{content.reviewed ? ` · ${fmt(content.reviewed)}` : ""}. Pick your registered functions to see what applies, what changes, and what to do before the compliance date.</p>
          </div>
          <div className="next" aria-live="polite">
            <span className="lbl">Next compliance date{fns.length ? ` · ${fns.join(", ")}` : ""}</span>
            {nx ? <>
              <span className="big">{daysUntil(nx.d, today)}<span>days</span></span>
              <span className="what">{nx.std} · {fmt(nx.d)}</span>
              <span className="sub">{nx.l === "effective" ? "Standard becomes enforceable" : nx.l}</span>
              <button type="button" onClick={() => go(nx.id)}>View details</button>
            </> : <span className="sub">No upcoming dates for the current filters.</span>}
          </div>
        </div>
      </section>

      <div className="wrap">
        {content.week && content.week.items.length > 0 && (
          <section className="week" aria-label="This week">
            <div className="wl">{content.week.label}<small>{content.week.covers}</small></div>
            <ul>{content.week.items.map((x, i) => <li key={i}>{x.b && <><b>{x.b}</b>{/^[A-Z]/.test(x.t || "") ? ": " : " "}</>}{x.t}</li>)}</ul>
          </section>
        )}

        <nav className="counts" aria-label="Summary">
          {([["approved", vis.filter((i) => i.newApproval).length, "New FERC approvals", "sec-upcoming"],
             ["upcoming", count("upcoming"), "Coming into effect", "sec-upcoming"],
             ["implementing", count("implementing") + count("recent"), "In effect or phasing in", "sec-implementing"],
             ["dev", count("dev"), "In development", "sec-dev"]] as const).map(([k, n, l, t]) => (
            <a key={k} className="count" data-k={k} href={`#${t}`} onClick={(e) => { e.preventDefault(); go(t); }}><b>{n}</b><span>{l}</span></a>
          ))}
        </nav>

        <div className="filters" role="group" aria-label="Filters">
          <div className="fgroup"><span className="flbl">Function</span>
            <button type="button" className="chip" aria-pressed={!fns.length} onClick={() => choose([], topics)}>All</button>
            {[FUNCTIONS.gen, FUNCTIONS.tx].map((list, gi) => (
              <span key={gi} style={{ display: "contents" }}>
                <span className="sep" aria-hidden="true" />
                {list.map((f) => <button type="button" key={f} className="chip fnc" aria-pressed={fns.includes(f)} onClick={() => choose(toggle(fns, f), topics)}>{f}</button>)}
              </span>
            ))}
          </div>
          <div className="fgroup"><span className="flbl">Topic</span>
            {Object.entries(TOPICS).map(([k, v]) => <button type="button" key={k} className="chip" aria-pressed={topics.includes(k)} onClick={() => choose(fns, toggle(topics, k))}>{v}</button>)}
          </div>
          <label className="search" htmlFor="q"><input id="q" type="search" placeholder="Search e.g. PRC-029" autoComplete="off" aria-label="Search standards" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>

        <div className="main">
          <div>
            {SECTIONS.map((sec) => {
              const list = vis.filter((i) => i.phase === sec.k);
              const key = (i: Classified) => (i.phase === "implementing" ? (i.milestones.find((m) => daysUntil(m.d, today) > 0) || { d: "9999-12-31" }).d : i.effective || "9999");
              if (sec.k === "dev") list.sort((a, b) => b.freshNews.length - a.freshNews.length);
              else list.sort((a, b) => (sec.k === "recent" ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));
              return (
                <section className="section" id={`sec-${sec.k}`} key={sec.k}>
                  <div className="sechead"><h2>{sec.h}</h2><span className="n">{list.length}</span></div>
                  <p className="secnote">{sec.note}</p>
                  <div className="cards">{list.length ? list.map((i) => card(i, sec.pill)) : <div className="empty">Nothing here for the current filters.</div>}</div>
                </section>
              );
            })}
          </div>
          <aside className="rail">
            <div className="panel"><h2>Compliance calendar</h2><div className="cal">{calRows.length ? calRows : <div className="empty" style={{ margin: "12px 16px" }}>No dates for the current filters.</div>}</div></div>
            <div className="panel"><h2>Comment periods &amp; events</h2>
              <ul className="plist">{dls.length ? dls.map((d) => (
                <li key={d.id} className={daysUntil(d.d, today) <= 14 ? "soon" : ""}><span className="fd">{fmt(d.d)} · {rel(d.d, today)}</span><span>{d.t}</span><span className="who">{d.who}</span></li>
              )) : <li><span className="who">No open comment periods or events for the current filters.</span></li>}</ul>
            </div>
            <div className="panel"><h2>Latest FERC &amp; NERC actions</h2>
              <ul className="plist">{acts.map((a) => <li key={a.id}><span className="fd"><span className="src">{a.src}</span>{fmt(a.d)}</span><span>{a.t}</span></li>)}</ul>
            </div>
          </aside>
        </div>
      </div>

      <section className="cta" aria-label="Help from CGM">
        <div className="wrap">
          <div>
            <h2>Not sure which of these apply to your facilities?</h2>
            <p>
              Applicability turns on facility details: IBR or synchronous, BES or Category 2, low or medium impact cyber systems, CIP-014 criteria,
              control center or not. CGM Consulting Group can map each standard to your registered functions and sites and build the implementation plan.
            </p>
            <p style={{ marginTop: 16 }}>
              <a className="nbtn" style={{ background: "#fff", color: "#0B2347" }} href="mailto:dan@cgmconsultinggroup.com?subject=Standards%20applicability%20review">Talk to CGM</a>
            </p>
          </div>
          <ul>
            <li>Applicability review by facility and registered function</li>
            <li>Gap assessments against new versions before the effective date</li>
            <li>Data specification, modeling and planning program updates for TO, TOP, TP and PC</li>
            <li>Procedure, evidence and training updates</li>
            <li>Category 2 IBR registration and onboarding support</li>
          </ul>
        </div>
      </section>

      <section className="foot watchnote" aria-label="About this page">
        <div className="wrap">
          <p>{WATCH_DISCLAIMER}</p>
        </div>
      </section>

      {Object.keys(content.sources).length > 0 && (
        <section className="foot sources" aria-label="Sources">
          <div className="wrap">
            <h2 className="srchead">Sources</h2>
            <ol>
              {Object.values(content.sources).map((s, i) => (
                <li key={i}>{s.u ? <a href={s.u} target="_blank" rel="noopener noreferrer">{s.t}</a> : s.t}</li>
              ))}
            </ol>
          </div>
        </section>
      )}
    </>
  );
}
