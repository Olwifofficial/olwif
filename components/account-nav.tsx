"use client";

import {useEffect, useState} from "react";
import {Wallet} from "lucide-react";
import {watchMemberSession} from "@/lib/member-session.js";

export default function AccountNav() {
  const [authenticated, setAuthenticated] = useState(false);
  useEffect(() => watchMemberSession(setAuthenticated), []);
  return <div className="account-nav" aria-label="Your account">
    <a className="account-connect" href={authenticated ? "/account" : "/account#connect-wallet"}><Wallet size={16} aria-hidden="true"/>{authenticated ? "My account" : "Connect wallet"}</a>
    <span className="account-keys-note">Your keys. Your wallet.</span>
  </div>;
}
