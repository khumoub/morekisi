"use client";
import { Fragment, useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { InboundContent } from "@/lib/whatsapp/inbound";
import { simHistory, simReset, simSend, type SimMessage, type SimSender } from "./actions";

const SUGGESTIONS: Record<SimSender, string[]> = {
  me: [
    "sold 20 cement 42.5 and 5 rebar 12mm to Kabelo on credit",
    "sold 2 cement cash",
    "Kabelo paid P500 orange money",
    "received 100 cement 42.5 from Builders Depot at P78",
    "how much rebar do we have?",
    "who owes us?",
    "sales today",
    "help",
  ],
  customer: ["hi", "do you have cement?", "price of IBR sheets", "I want to talk to someone"],
};

/** WhatsApp formatting: *bold*, _italic_, line breaks. */
function formatText(text: string): ReactNode {
  return text.split("\n").map((line, i, all) => (
    <Fragment key={i}>
      {line.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, j) =>
        /^\*[^*]+\*$/.test(part) ? (
          <strong key={j}>{part.slice(1, -1)}</strong>
        ) : /^_[^_]+_$/.test(part) ? (
          <em key={j}>{part.slice(1, -1)}</em>
        ) : (
          <Fragment key={j}>{part}</Fragment>
        ),
      )}
      {i < all.length - 1 && <br />}
    </Fragment>
  ));
}

async function openDataUrl(url: string) {
  // Browsers block opening data: URLs directly; turn it into a blob URL first.
  const blob = await (await fetch(url)).blob();
  window.open(URL.createObjectURL(blob), "_blank");
}

function BotMessage({ m, onReply, disabled }: { m: SimMessage; onReply: (c: InboundContent) => void; disabled: boolean }) {
  const [listOpen, setListOpen] = useState(false);
  const p = m.payload;
  const bubble = "max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm shadow-sm dark:bg-neutral-800";

  if (p?.type === "document") {
    return (
      <div className={bubble}>
        <button
          disabled={!p.link}
          onClick={() => p.link && openDataUrl(p.link)}
          className="flex w-full items-center gap-3 rounded-md bg-neutral-100 p-2 text-left hover:bg-neutral-200 dark:bg-neutral-700"
        >
          <span className="rounded bg-red-600 px-1.5 py-1 text-[10px] font-bold text-white">PDF</span>
          <span className="font-medium">{p.filename}</span>
        </button>
        {p.caption && <p className="mt-1 text-neutral-600 dark:text-neutral-300">{p.caption}</p>}
      </div>
    );
  }

  const body = p && "body" in p ? p.body : m.text;
  return (
    <div className="max-w-[85%]">
      <div className={bubble}>{formatText(body)}</div>
      {p?.type === "buttons" && (
        <div className="mt-1 grid gap-1">
          {p.buttons.map((b) => (
            <button
              key={b.id}
              disabled={disabled}
              onClick={() => onReply({ kind: "button", id: b.id, title: b.title })}
              className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-sky-700 shadow-sm hover:bg-sky-50 disabled:opacity-50 dark:bg-neutral-800 dark:text-sky-400"
            >
              {b.title}
            </button>
          ))}
        </div>
      )}
      {p?.type === "list" && (
        <div className="mt-1">
          <button
            onClick={() => setListOpen((o) => !o)}
            className="w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-sky-700 shadow-sm hover:bg-sky-50 dark:bg-neutral-800 dark:text-sky-400"
          >
            ☰ {p.button}
          </button>
          {listOpen && (
            <div className="mt-1 divide-y divide-neutral-100 rounded-lg bg-white shadow-sm dark:divide-neutral-700 dark:bg-neutral-800">
              {p.sections.flatMap((s) => s.rows).map((r) => (
                <button
                  key={r.id}
                  disabled={disabled}
                  onClick={() => {
                    setListOpen(false);
                    onReply({ kind: "list", id: r.id, title: r.title });
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-700"
                >
                  <span className="block font-medium">{r.title}</span>
                  {r.description && <span className="block text-xs text-neutral-500">{r.description}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SimulatorChat({ aiLabel, myName }: { aiLabel: string; myName: string }) {
  const [as, setAs] = useState<SimSender>("me");
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async (who: SimSender) => {
    const res = await simHistory(who);
    setMessages(res.messages);
    setError(res.error ?? null);
  }, []);

  useEffect(() => {
    load(as);
  }, [as, load]);
  useEffect(() => {
    // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect must return nothing.
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send(content: InboundContent) {
    setError(null);
    // Show the message straight away, like WhatsApp does
    const label = content.kind === "text" ? content.text : content.kind === "button" || content.kind === "list" ? content.title : "";
    setMessages((m) => [...m, { id: -Date.now(), direction: "in", text: label, payload: null, at: new Date().toISOString() }]);
    startTransition(async () => {
      const res = await simSend(as, content);
      if (res.error) setError(res.error);
      await load(as);
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || pending) return;
    send({ kind: "text", text: text.trim() });
    setText("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="flex h-[70vh] min-h-[480px] flex-col overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-2 bg-emerald-800 px-4 py-3 text-white">
          <div>
            <p className="font-medium">{as === "me" ? `${myName} → your shop (back office)` : "Test customer → your shop"}</p>
            <p className="text-xs text-emerald-100">{aiLabel}</p>
          </div>
          <button
            onClick={() => startTransition(async () => (await simReset(as), await load(as)))}
            className="rounded-md bg-emerald-900/40 px-2 py-1 text-xs hover:bg-emerald-900/70"
          >
            Clear chat
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-4 dark:bg-neutral-950">
          {messages.length === 0 && (
            <p className="mx-auto mt-8 max-w-xs rounded-lg bg-white/80 p-3 text-center text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              Send a message, or pick an example on the right.
            </p>
          )}
          {messages.map((m) =>
            m.direction === "in" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-sm shadow-sm dark:bg-emerald-900">
                  {formatText(m.text)}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex">
                <BotMessage m={m} onReply={send} disabled={pending} />
              </div>
            ),
          )}
          {pending && <p className="text-xs text-neutral-500">typing…</p>}
          <div ref={bottom} />
        </div>

        {error && <p className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p>}
        <form onSubmit={submit} className="flex gap-2 border-t border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message"
            className="flex-1 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-950"
          />
          <button disabled={pending || !text.trim()} className="rounded-full bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50">
            Send
          </button>
        </form>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="mb-2 text-sm font-medium">Chat as</p>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 text-sm dark:bg-neutral-800">
            {(["me", "customer"] as const).map((who) => (
              <button
                key={who}
                onClick={() => setAs(who)}
                className={`rounded-md px-2 py-1.5 ${as === who ? "bg-white font-medium shadow-sm dark:bg-neutral-950" : "text-neutral-600 dark:text-neutral-400"}`}
              >
                {who === "me" ? "Me (staff)" : "A customer"}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="mb-2 text-sm font-medium">Try</p>
          <div className="flex flex-col gap-1">
            {SUGGESTIONS[as].map((s) => (
              <button
                key={s}
                disabled={pending}
                onClick={() => send({ kind: "text", text: s })}
                className="rounded-md px-2 py-1.5 text-left text-sm text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-neutral-800"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
