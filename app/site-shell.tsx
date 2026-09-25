import AccountNav from "@/components/account-nav";
type SiteShellProps = {
  children: React.ReactNode;
  home?: boolean;
  footerTools?: React.ReactNode;
};

export default function SiteShell({children, home = false, footerTools}: SiteShellProps) {
  return (
    <div className={home ? "site-shell minimalist-home" : "site-shell"}>
      {home && <div className="home-account-controls"><AccountNav/></div>}
      {!home && (
        <header className="site-header">
          <a className="wordmark" href="/">olwif<span>✦</span></a>
          <nav aria-label="Main navigation">
            <a href="/library">Research library</a>
            <a href="/about">How O checks</a>
            <AccountNav/>
          </nav>
        </header>
      )}
      {children}
      <footer className="site-footer quiet-footer">
        <a className="footer-wordmark" href="/" aria-label="OLWIF home">olwif</a>
        <nav aria-label="Footer navigation">
          <a href="/library">Research library</a>
          <a href="/about">How O checks</a>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
        {footerTools && <div className="footer-tools">{footerTools}</div>}
        <span className="footer-disclaimer">Research, not financial advice.</span>
      </footer>
    </div>
  );
}
