"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNearWallet } from "near-connect-hooks";

type Message = { id: string; accountId: string; name?: string; message: string; imageUrl?: string; createdAt: number };

export function BuildChat({ day }: { day: number }) {
  const { signedAccountId, signIn, signNEP413Message } = useNearWallet();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/chat?day=${day}`, { cache: "no-store" });
    const data = await response.json() as { messages?: Message[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load build chat");
    setMessages(data.messages ?? []);
  }, [day]);

  useEffect(() => {
    void load().catch((error: Error) => setStatus(error.message));
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const post = async (event: FormEvent) => {
    event.preventDefault();
    if (!signedAccountId) { await signIn(); return; }
    const message = draft.trim();
    const image = imageUrl.trim();
    if (!message && !image) return;
    setStatus("Confirm this message in your wallet…");
    try {
      const challengeResponse = await fetch("/api/chat/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: signedAccountId, day, message, imageUrl: image }) });
      const challenge = await challengeResponse.json() as { message?: string; nonce?: string; recipient?: string; error?: string };
      if (!challengeResponse.ok || !challenge.message || !challenge.nonce || !challenge.recipient) throw new Error(challenge.error ?? "Could not prepare message");
      const nonce = Uint8Array.from(atob(challenge.nonce), (character) => character.charCodeAt(0));
      const signed = await signNEP413Message({ message: challenge.message, recipient: challenge.recipient, nonce });
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: signedAccountId, day, message, imageUrl: image, nonce: challenge.nonce, publicKey: signed.publicKey, signature: signed.signature }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Message was not posted");
      setDraft("");
      setImageUrl("");
      setStatus("");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Message was not posted");
    }
  };

  return <section className="build-chat" aria-label={`Day ${day} build chat`}>
    <header><h2>Build chat</h2><span>{messages.length} recent</span></header>
    <div className="chat-log" aria-live="polite">
      {messages.length === 0 ? <p className="chat-empty">Start the plan: what should everyone add next?</p> : messages.map((item) => <article key={item.id}>
        <div><strong>{item.name ?? item.accountId}</strong>{item.name && <small>{item.accountId}</small>}<time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
        {item.message && <p>{item.message}</p>}
        {item.imageUrl && <a className="chat-image" href={item.imageUrl} rel="noreferrer" target="_blank"><img alt={`Shared by ${item.name ?? item.accountId}`} loading="lazy" src={item.imageUrl} /></a>}
      </article>)}
    </div>
    <form onSubmit={(event) => void post(event)}><label htmlFor="chat-message">Share an idea</label><textarea id="chat-message" maxLength={280} onChange={(event) => setDraft(event.target.value)} placeholder="Add a tail next?" rows={3} value={draft} /><label className="image-link-label" htmlFor="chat-image">Image link <span>optional</span></label><input id="chat-image" maxLength={1000} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…" type="url" value={imageUrl} /><div><small>{draft.length}/280</small><button type="submit">{signedAccountId ? "Post" : "Connect to chat"}</button></div></form>
    {status && <p className="chat-status" role="status">{status}</p>}
  </section>;
}
