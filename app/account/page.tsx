import type {Metadata} from "next";
import SiteShell from "@/app/site-shell";
import AccountDesk from "./account-desk";

export const metadata: Metadata = {title: "Your account · OLWIF", robots: {index: false, follow: false}};

export default function AccountPage() {
  return <SiteShell><main className="page-wrap account-page"><AccountDesk/></main></SiteShell>;
}
