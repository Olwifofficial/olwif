"use client";

import {useCallback, useEffect, useRef, useState, type FormEvent} from "react";
import Link from "next/link";
import {Bell, Bookmark, ChevronRight, FolderHeart, RefreshCw, ShieldCheck, Wallet} from "lucide-react";
import {isQuietTime} from "@/lib/member-rules.js";
import {publishMemberSession} from "@/lib/member-session.js";

type PublicKey = {toString(): string};
export type WalletProvider = {
  publicKey?: PublicKey;
  connect(): Promise<{publicKey?: PublicKey} | void>;
  signMessage(message: Uint8Array, display?: string): Promise<{signature: Uint8Array} | Uint8Array>;
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
};
type WalletChoice = {name: string; provider: WalletProvider};
type WalletWindow = {phantom?: {solana?: WalletProvider}; solflare?: WalletProvider; backpack?: {solana?: WalletProvider}; solana?: WalletProvider};
type Preferences = {alertsEnabled: boolean; priceChangePct: number; liquidityDropPct: number; riskChanges: boolean; quietStart: string; quietEnd: string};
type SavedReport = {id: string; name: string; symbol: string; chain: string; address: string; createdAt: string | number};
type Watch = {tokenKey: string; name: string; symbol: string; chain: string; address: string; reportId: string; quantity: number | null; costBasisUsd: number | null; latestPriceUsd: number | null; lastCheckedAt: string | number | null; monitorEnabled: boolean};
type Alert = {id: string; title: string; body: string; createdAt: string | number; read: boolean; reportId?: string};
type Member = {authenticated: true; walletAddress: string; savedReports: SavedReport[]; watchlist: Watch[]; notifications: Alert[]; preferences: Preferences; monitoring: {active: boolean; message: string}; rewards: {enabled: boolean; message: string}};
type MemberResult = Member | {authenticated: false};
class AccountRequestError extends Error {
  constructor(message: string, public status: number) {super(message);}
}

export function detectedWallets(source: WalletWindow): WalletChoice[] {
  const choices: WalletChoice[] = [];
  const add = (name: string, provider?: WalletProvider) => {
    if (provider && typeof provider.connect === "function" && typeof provider.signMessage === "function" && !choices.some(item => item.provider === provider)) choices.push({name, provider});
  };
  add("Phantom", source.phantom?.solana);
  add("Solflare", source.solflare);
  add("Backpack", source.backpack?.solana);
  if (source.solana) add(source.solana.isPhantom ? "Phantom" : source.solana.isSolflare ? "Solflare" : source.solana.isBackpack ? "Backpack" : "Solana wallet", source.solana);
  return choices;
}

export function safeReturnTo(value: string | null): string | null {
  return value && /^\/report\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

async function jsonRequest<T>(url: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers: body ? {"Content-Type": "application/json"} : undefined, body: body ? JSON.stringify(body) : undefined, signal});
  const data = await response.json() as T & {error?: string; authenticated?: boolean};
  if (response.status === 401 && !body && url === "/api/member" && data.authenticated === false) return data;
  if (!response.ok) throw new AccountRequestError(data.error || (response.status === 401 ? "Your session has ended. Sign in again to continue." : "That didn’t go through. Please try again."), response.status);
  return data;
}

export async function authenticateWallet(provider: WalletProvider, signal: AbortSignal, stage: (message: string) => void): Promise<void> {
  stage("Open your wallet to connect.");
  const connected = await provider.connect();
  signal.throwIfAborted();
  const address = (connected?.publicKey || provider.publicKey)?.toString();
  if (!address) throw new Error("Your wallet did not share an address. Please reconnect.");
  const challenge = await jsonRequest<{message: string; challengeId: string}>("/api/auth/challenge", {address}, signal);
  signal.throwIfAborted();
  if (typeof challenge.message !== "string" || typeof challenge.challengeId !== "string") throw new Error("A sign-in message could not be prepared.");
  stage("Approve the sign-in message in your wallet. It does not send a transaction.");
  const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), "utf8");
  signal.throwIfAborted();
  if (provider.publicKey && provider.publicKey.toString() !== address) throw new Error("Your wallet address changed. Start sign-in again.");
  const signature = signed instanceof Uint8Array ? signed : signed.signature;
  if (!(signature instanceof Uint8Array) || signature.length !== 64) throw new Error("Your wallet returned an unsupported signature. Please try another wallet.");
  stage("Opening your account…");
  await jsonRequest("/api/auth/verify", {address, challengeId: challenge.challengeId, signature: btoa(String.fromCharCode(...signature))}, signal);
}

function when(value: string | number | null): string {
  if (value === null || value === "") return "Not checked yet";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Time unavailable" : date.toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"});
}

export function positionValue(watch: Pick<Watch, "quantity" | "latestPriceUsd">): number | null {
  if (typeof watch.quantity !== "number" || typeof watch.latestPriceUsd !== "number" || !Number.isFinite(watch.quantity) || !Number.isFinite(watch.latestPriceUsd) || watch.quantity < 0 || watch.latestPriceUsd < 0) return null;
  const value = watch.quantity * watch.latestPriceUsd;
  return Number.isFinite(value) ? value : null;
}

function money(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "Not available" : new Intl.NumberFormat(undefined, {style: "currency", currency: "USD", maximumFractionDigits: value > 0 && value < .01 ? 8 : 2}).format(value);
}

function Empty({children}: {children: React.ReactNode}) {return <div className="account-empty">{children}</div>;}

export function WalletReassurance() {
  return <section className="wallet-reassurance" aria-labelledby="wallet-reassurance-title">
    <h3 id="wallet-reassurance-title"><ShieldCheck size={21} aria-hidden="true"/>Your keys. Your wallet.</h3>
    <p>Your private keys and recovery phrase stay with you. OLWIF never asks for them.</p>
    <p><strong>This connection and our sign-in message do not authorise transactions, spending approvals or access to move your funds.</strong></p>
    <details><summary>What am I sharing?</summary><p>OLWIF receives your public wallet address and a signed message proving you control it. That opens your research account; it does not hand over your wallet.</p><p>Check the website address and read the wallet prompt. Cancel any request to send funds, approve spending or share your recovery phrase. Connecting to a site is not a reason to trust every later request.</p></details>
  </section>;
}

export function desktopUpdates(alerts: Alert[], seen: Set<string> | null, preferences: Preferences, now = Date.now()): Alert[] {
  if (!seen || !preferences.alertsEnabled || isQuietTime(preferences, now)) return [];
  return alerts.filter(item => !item.read && !seen.has(item.id));
}

function PositionForm({watch, busy, update}: {watch: Watch; busy: boolean; update: (action: Record<string, unknown>, message: string) => Promise<void>}) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const quantity = String(form.get("quantity") || "").trim();
    const cost = String(form.get("costBasisUsd") || "").trim();
    if ([quantity, cost].some(value => value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0))) {setError("Enter positive amounts or leave the fields blank."); return;}
    setError("");
    await update({action: "updatePosition", tokenKey: watch.tokenKey, quantity: quantity === "" ? null : Number(quantity), costBasisUsd: cost === "" ? null : Number(cost)}, "Your position is saved.");
  }
  return <details className="account-position"><summary>Edit your position</summary><form onSubmit={submit} className="account-position-form">
    <label>Tokens held<input name="quantity" type="number" min="0" step="any" placeholder="Optional" defaultValue={watch.quantity ?? ""}/></label>
    <label>Total cost in USD<input name="costBasisUsd" type="number" min="0" step="any" placeholder="Optional" defaultValue={watch.costBasisUsd ?? ""}/></label>
    <button className="account-button secondary" type="submit" disabled={busy}>Save position</button>
    <p className="account-hint">Only visible in your account. Leave blank to remove an amount.</p>
    {error && <p className="account-error" role="alert">{error}</p>}
  </form></details>;
}

export default function AccountDesk() {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const [walletName, setWalletName] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [desktop, setDesktop] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const request = useRef<AbortController | null>(null);
  const seenAlerts = useRef<Set<string> | null>(null);
  const desktopRef = useRef(false);
  const mounted = useRef(false);

  const applyMember = useCallback((data: MemberResult) => {
    publishMemberSession(data.authenticated);
    if (!data.authenticated) {setMember(null); seenAlerts.current = null; return;}
    if (seenAlerts.current && desktopRef.current && "Notification" in window && Notification.permission === "granted") {
      const fresh = desktopUpdates(data.notifications, seenAlerts.current, data.preferences);
      if (fresh.length) {
        try {new Notification("O found an update", {body: fresh.length === 1 ? fresh[0].title : `${fresh.length} new updates in your OLWIF account.`, icon: "/o-owl.png", tag: "olwif-account-updates"});} catch { /* Alerts remain available in the account if the browser cannot show a notice. */ }
      }
    }
    seenAlerts.current = new Set(data.notifications.map(item => item.id));
    setMember(data);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    request.current = controller;
    const refreshWallets = () => {
      const available = detectedWallets(window as unknown as WalletWindow);
      setWallets(available);
      setWalletName(current => available.some(item => item.name === current) ? current : available[0]?.name || "");
    };
    refreshWallets();
    window.addEventListener("focus", refreshWallets);
    void jsonRequest<MemberResult>("/api/member", undefined, controller.signal).then(applyMember).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Your account could not be loaded.");
    }).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => {mounted.current = false; request.current?.abort(); window.removeEventListener("focus", refreshWallets);};
  }, [applyMember]);

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(""); setStatus("");
    try {await task(controller.signal);} catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof AccountRequestError && cause.status === 401) {applyMember({authenticated: false}); desktopRef.current = false; setDesktop(false);}
        setStatus("");
        setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
      }
    } finally {if (mounted.current && !controller.signal.aborted) setBusy(false);}
  }

  async function update(action: Record<string, unknown>, message: string) {
    await run(async signal => {applyMember(await jsonRequest<Member>("/api/member", action, signal)); setStatus(message);});
  }

  function signIn() {
    const wallet = wallets.find(item => item.name === walletName);
    if (!wallet) {setError("No supported wallet is available. Open this page in your Solana wallet’s browser, or enable its browser extension."); return;}
    void run(async signal => {
      await authenticateWallet(wallet.provider, signal, message => {if (!signal.aborted) setStatus(message);});
      applyMember(await jsonRequest<Member>("/api/member", undefined, signal));
      setStatus("You’re signed in. Make yourself at home.");
      const destination = safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
      if (destination) window.location.assign(destination);
    });
  }

  async function desktopNotices() {
    if (desktop) {desktopRef.current = false; setDesktop(false); setStatus("Desktop notices are off for this visit."); return;}
    if (!("Notification" in window)) {setError("This browser does not support desktop notices. Your updates are always available in Alerts."); return;}
    try {
      const permission = await Notification.requestPermission();
      const allowed = permission === "granted";
      if (!mounted.current) return;
      desktopRef.current = allowed; setDesktop(allowed);
      setStatus(allowed ? "Desktop notices are on while this account page is open. Refresh or check your watchlist to receive new updates." : "Desktop notices weren’t enabled. You can still read updates in Alerts.");
    } catch {setError("Desktop notices could not be enabled. You can still read updates in Alerts.");}
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const quietStart = String(form.get("quietStart") || ""), quietEnd = String(form.get("quietEnd") || "");
    if (Boolean(quietStart) !== Boolean(quietEnd)) {setError("Set both quiet-hour times, or clear both."); return;}
    await update({action: "preferences", preferences: {alertsEnabled: form.has("alertsEnabled"), priceChangePct: Number(form.get("priceChangePct")), liquidityDropPct: Number(form.get("liquidityDropPct")), riskChanges: form.has("riskChanges"), quietStart, quietEnd}}, "Your alert settings are saved.");
  }

  const unread = member?.notifications.filter(item => !item.read).length || 0;
  return <>
    <header className="account-heading"><div><p className="eyebrow">YOUR LITTLE RESEARCH SPACE</p><h1>{member ? "Welcome back." : "Keep what O finds."}</h1><p>{member ? "Your reports, your portfolio, and a watchful little owl." : "Save reports, build a private portfolio and keep up with the tokens you follow."}</p></div><img src="/o-owl.png" alt="O the owl" width="118" height="123"/></header>
    <div className="account-feedback" aria-live="polite" aria-atomic="true">{status && <p className="account-status" role="status">{status}</p>}{error && <p className="account-error" role="alert">{error}</p>}</div>
    {loading ? <div className="panel account-loading" role="status">O is opening your research space…</div> : !member ? <>
      <section className="panel account-connect-panel" id="connect-wallet" aria-labelledby="connect-title">
        <div className="account-icon"><Wallet aria-hidden="true" size={25}/></div><h2 id="connect-title">One wallet. Your own space.</h2><p>Connect your Solana wallet and approve a sign-in message. Your first visit creates your account automatically; returning with the same wallet opens your saved reports and portfolio.</p>
        <WalletReassurance/>
        <div className="account-connect-form">{wallets.length > 0 ? <><label htmlFor="wallet-choice">Choose your wallet</label><select id="wallet-choice" value={walletName} onChange={event => setWalletName(event.target.value)} disabled={busy}>{wallets.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select><button className="account-button" onClick={signIn} disabled={busy}><Wallet size={17} aria-hidden="true"/>{busy ? "Waiting for your wallet…" : "Connect wallet"}</button></> : <div className="account-wallet-help"><p>No Solana wallet detected yet.</p><p className="account-hint">Use your Phantom, Solflare or Backpack browser extension, or open OLWIF in your wallet’s browser.</p><button className="account-button secondary" onClick={() => {const available = detectedWallets(window as unknown as WalletWindow); setWallets(available); setWalletName(available[0]?.name || ""); setStatus(available.length ? "Your wallet is ready." : "No wallet detected yet. Check your wallet extension is enabled for this site.");}}>Check for my wallet</button></div>}</div>
        {busy && <button className="account-text-button" onClick={() => {request.current?.abort(); setBusy(false); setStatus("Connection cancelled. You can close the wallet request.");}}>Cancel connection</button>}
        <p className="account-hint">Use the same wallet each time to access your saved reports and positions. By signing in, you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy policy</a>.</p>
      </section>
      <div className="account-benefits"><article><Bookmark aria-hidden="true"/><h2>A shelf of your own</h2><p>Keep the reports you want to come back to.</p></article><article><FolderHeart aria-hidden="true"/><h2>A private portfolio</h2><p>Add holdings and follow their recorded value.</p></article><article><Bell aria-hidden="true"/><h2>Updates that matter</h2><p>Choose price, liquidity and research alerts.</p></article></div>
      <aside className="account-rewards"><span className="tag">Coming later</span><h2>Community rewards</h2><p>The OLWIF token and signup reward campaign have not launched. Bonus amounts and claim details will appear here when a funded campaign is available.</p></aside>
    </> : <>
      <div className="account-identity"><span><ShieldCheck size={16} aria-hidden="true"/>Signed in as <code title={member.walletAddress}>{member.walletAddress.slice(0, 6)}…{member.walletAddress.slice(-5)}</code></span><button className="account-text-button" disabled={busy} onClick={() => void run(async signal => {await jsonRequest("/api/auth/logout", {}, signal); applyMember({authenticated: false}); desktopRef.current = false; setDesktop(false); setStatus("You’re signed out.");})}>Sign out</button></div>
      <nav className="account-sections" aria-label="Account sections"><a href="#saved-reports"><Bookmark size={16} aria-hidden="true"/>Reports <span>{member.savedReports.length}</span></a><a href="#portfolio"><FolderHeart size={16} aria-hidden="true"/>Portfolio <span>{member.watchlist.length}</span></a><a href="#alerts"><Bell size={16} aria-hidden="true"/>Alerts {unread > 0 && <span>{unread} new</span>}</a><a href="#settings">Settings</a></nav>
      <section className="panel account-section" id="saved-reports" aria-labelledby="saved-title"><div className="account-section-heading"><div><h2 id="saved-title">Your saved reports</h2><p>Research snapshots, ready when you need them.</p></div><Link className="account-button secondary" href="/">Find a token<ChevronRight size={16} aria-hidden="true"/></Link></div>
        {member.savedReports.length ? <ul className="account-list">{member.savedReports.map(report => <li key={report.id}><div className="account-token"><a href={`/report/${encodeURIComponent(report.id)}`}>{report.name || "Unnamed token"} <span>{report.symbol}</span></a><p>{report.chain} · Checked {when(report.createdAt)}</p><code>{report.address}</code></div><div className="account-item-actions"><button className="account-button secondary" disabled={busy || member.watchlist.some(watch => watch.reportId === report.id || (watch.address === report.address && watch.chain === report.chain))} onClick={() => void update({action: "addWatch", reportId: report.id}, "Added to your portfolio watchlist.")}>{member.watchlist.some(watch => watch.reportId === report.id || (watch.address === report.address && watch.chain === report.chain)) ? "Following" : "Follow token"}</button><button className="account-text-button" disabled={busy} onClick={() => void update({action: "removeReport", reportId: report.id}, "Report removed from your saved list.")}>Remove<span className="sr-only"> {report.name} report</span></button></div></li>)}</ul> : <Empty><Bookmark size={28} aria-hidden="true"/><h3>A fresh shelf.</h3><p>Open a token report and choose “Save report” to keep it here.</p><a className="inline-link" href="/library">Browse the research library</a></Empty>}
      </section>
      <section className="panel account-section" id="portfolio" aria-labelledby="portfolio-title"><div className="account-section-heading"><div><h2 id="portfolio-title">Your portfolio & watchlist</h2><p>Follow tokens, then add your holdings if you like.</p></div><button className="account-button secondary" disabled={busy || !member.watchlist.some(item => item.monitorEnabled)} onClick={() => void run(async signal => {const checked = await jsonRequest<{checked: number; message: string}>("/api/member/check", {}, signal); applyMember(await jsonRequest<Member>("/api/member", undefined, signal)); setStatus(checked.message || `${checked.checked} tokens checked.`);})}><RefreshCw size={16} aria-hidden="true"/>Check now</button></div>
        <p className="account-monitor-note"><span className={`account-dot${member.monitoring.active ? " active" : ""}`} aria-hidden="true"/>{member.monitoring.message}</p>
        {member.watchlist.length ? <ul className="account-watchlist">{member.watchlist.map(watch => <li key={watch.tokenKey}><div className="account-section-heading"><div className="account-token"><a href={`/report/${encodeURIComponent(watch.reportId)}`}>{watch.name || "Unnamed token"} <span>{watch.symbol}</span></a><p>{watch.chain} · Last checked {when(watch.lastCheckedAt)}</p><code>{watch.address}</code></div><label className="account-checkbox"><input type="checkbox" checked={watch.monitorEnabled} disabled={busy} onChange={event => void update({action: "updateWatch", tokenKey: watch.tokenKey, monitorEnabled: event.target.checked}, event.target.checked ? "Token checks resumed." : "Token checks paused.")}/>Follow updates</label></div><dl className="account-position-values"><div><dt>Last recorded price</dt><dd>{money(watch.latestPriceUsd)}</dd></div><div><dt>Your tokens</dt><dd>{watch.quantity === null ? "Not entered" : watch.quantity.toLocaleString(undefined, {maximumFractionDigits: 8})}</dd></div><div><dt>Estimated holding value</dt><dd>{money(positionValue(watch))}</dd></div><div><dt>Total cost</dt><dd>{watch.costBasisUsd === null ? "Not entered" : money(watch.costBasisUsd)}</dd></div></dl><div className="account-watch-bottom"><PositionForm key={`${watch.tokenKey}:${watch.quantity}:${watch.costBasisUsd}`} watch={watch} busy={busy} update={update}/><button className="account-text-button" disabled={busy} onClick={() => void update({action: "removeWatch", tokenKey: watch.tokenKey}, "Token removed from your portfolio.")}>Remove token<span className="sr-only"> {watch.name}</span></button></div></li>)}</ul> : <Empty><FolderHeart size={28} aria-hidden="true"/><h3>Give O something to watch.</h3><p>Choose “Follow token” on one of your saved reports to start your portfolio.</p></Empty>}
        <p className="account-hint">Holdings are entered by you. Values use the last recorded price; they are estimates, not live quotes or wallet balances.</p>
      </section>
      <section className="panel account-section" id="alerts" aria-labelledby="alerts-title"><div className="account-section-heading"><div><h2 id="alerts-title">Your alerts</h2><p>Changes to the tokens you follow.</p></div><div className="account-item-actions"><button className="account-button secondary" disabled={busy} onClick={() => void run(async signal => {applyMember(await jsonRequest<Member>("/api/member", undefined, signal)); setStatus("Your account is up to date.");})}><RefreshCw size={16} aria-hidden="true"/>Refresh</button>{unread > 0 && <button className="account-text-button" disabled={busy} onClick={() => void update({action: "markRead", all: true}, "All alerts marked as read.")}>Mark all read</button>}</div></div>
        {member.notifications.length ? <ul className="account-alert-list">{member.notifications.map(alert => <li key={alert.id} className={alert.read ? "read" : "unread"}><div><h3>{!alert.read && <span className="account-dot active" aria-label="Unread"/>}{alert.title}</h3><p>{alert.body}</p><time>{when(alert.createdAt)}</time></div><div className="account-item-actions">{alert.reportId && <a className="inline-link" href={`/report/${encodeURIComponent(alert.reportId)}`}>View report</a>}{!alert.read && <button className="account-text-button" disabled={busy} onClick={() => void update({action: "markRead", id: alert.id}, "Alert marked as read.")}>Mark read<span className="sr-only">: {alert.title}</span></button>}</div></li>)}</ul> : <Empty><Bell size={28} aria-hidden="true"/><h3>Nothing new just yet.</h3><p>When a check finds a change that matches your settings, O will put it here.</p></Empty>}
      </section>
      <section className="panel account-section" id="settings" aria-labelledby="settings-title"><div className="account-section-heading"><div><h2 id="settings-title">Make O’s updates your own</h2><p>Pick what matters, and when you want some quiet.</p></div></div><form onSubmit={savePreferences} className="account-settings" key={JSON.stringify(member.preferences)}>
        <label className="account-checkbox"><input type="checkbox" name="alertsEnabled" defaultChecked={member.preferences.alertsEnabled}/>Enable watchlist alerts</label>
        <label className="account-checkbox"><input type="checkbox" name="riskChanges" defaultChecked={member.preferences.riskChanges}/>Tell me when the research checks change</label>
        <div className="account-field-grid"><label>Price move, up or down (%)<input type="number" name="priceChangePct" min="1" max="1000" step="1" required defaultValue={member.preferences.priceChangePct}/></label><label>Liquidity drop (%)<input type="number" name="liquidityDropPct" min="1" max="100" step="1" required defaultValue={member.preferences.liquidityDropPct}/></label></div>
        <fieldset><legend>Quiet hours (UTC)</legend><p className="account-hint">Pause desktop notices during these hours. Your alerts will still be saved here. Leave both times blank for no quiet hours.</p><div className="account-field-grid"><label>From<input name="quietStart" type="time" defaultValue={member.preferences.quietStart}/></label><label>Until<input name="quietEnd" type="time" defaultValue={member.preferences.quietEnd}/></label></div></fieldset>
        <button type="submit" className="account-button" disabled={busy}>Save alert settings</button>
      </form><div className="account-desktop"><div><h3>Desktop notices</h3><p>Optional notices for new alerts received while this account page is open. Refresh or run a check to get updates. Email and closed-browser push are not available yet.</p></div><button className="account-button secondary" type="button" aria-pressed={desktop} onClick={() => void desktopNotices()}>{desktop ? "Turn off desktop notices" : "Enable desktop notices"}</button></div></section>
      <aside className="account-rewards"><span className="tag">Coming later</span><h2>Community rewards</h2><p>{member.rewards.message || "The OLWIF token and signup reward campaign have not launched. No bonus is available to claim yet."}</p></aside>
      <section className="account-delete"><button className="account-text-button" onClick={() => setDeleteOpen(open => !open)} disabled={busy}>Delete my account</button>{deleteOpen && <div className="account-delete-confirm"><p>This permanently removes your saved reports list, private positions, watchlist and alerts. Public research reports remain in the library.</p><button className="account-button danger" disabled={busy} onClick={() => void run(async signal => {await jsonRequest("/api/member", {action: "deleteAccount"}, signal); applyMember({authenticated: false}); desktopRef.current = false; setDesktop(false); setDeleteOpen(false); setStatus("Your account and private saved data have been deleted.");})}>Permanently delete my account</button><button className="account-text-button" disabled={busy} onClick={() => setDeleteOpen(false)}>Keep my account</button></div>}</section>
    </>}
  </>;
}
