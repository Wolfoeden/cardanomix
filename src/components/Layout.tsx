import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { formatPrice } from "../../shared/money";
import { useAuth } from "../auth";
import { useConfig, usePrices } from "../hooks";
import { Logo, MenuIcon, WalletIcon, CloseIcon } from "./Icons";
import { Avatar } from "./Ui";

function PriceChip() {
  const prices = usePrices();
  const eur = prices?.prices.EUR;
  if (!eur) return null;
  const change = eur.change24h;
  return (
    <span className="price-chip" title={prices?.source ? `Quelle: ${prices.source}` : undefined}>
      <span className="price-chip-label">ADA</span>
      <span>{formatPrice(eur.priceMicro, "EUR")}</span>
      {change != null && (
        <span className={change >= 0 ? "up" : "down"}>
          {change >= 0 ? "+" : "−"}
          {Math.abs(change).toFixed(1).replace(".", ",")} %
        </span>
      )}
    </span>
  );
}

function AccountMenu() {
  const { me, ready, openLogin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!ready) return <span className="account-placeholder" />;
  if (!me) {
    return (
      <button type="button" className="btn btn-primary" onClick={openLogin} aria-label="Wallet verbinden">
        <WalletIcon />
        <span>Wallet verbinden</span>
      </button>
    );
  }
  return (
    <div className="account" ref={ref}>
      <button
        type="button"
        className="account-button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Konto-Menü von ${me.displayName}`}
      >
        <Avatar user={me} size={28} />
        <span className="account-name">{me.displayName}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <Link to="/konto" role="menuitem">
            Meine Trades
          </Link>
          <Link to="/konto?tab=angebote" role="menuitem">
            Meine Angebote
          </Link>
          <Link to="/konto?tab=profil" role="menuitem">
            Profil &amp; Wallet
          </Link>
          {me.isAdmin && (
            <Link to="/admin" role="menuitem">
              Moderation
            </Link>
          )}
          <button type="button" role="menuitem" onClick={() => void logout()}>
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const config = useConfig();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setNavOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#inhalt">
        Zum Inhalt springen
      </a>
      {config?.network === "preprod" && (
        <div className="network-banner">Testnetz (Preprod) – hier wird nur mit Test-ADA gehandelt.</div>
      )}
      <header className="header">
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label="CardanoMix P2P – Startseite">
            <Logo />
            <span className="brand-text">
              CardanoMix <strong>P2P</strong>
            </span>
            <span className="beta">Beta</span>
          </Link>
          <nav className={`nav ${navOpen ? "nav-open" : ""}`} aria-label="Hauptnavigation">
            <NavLink to="/" end>
              Marktplatz
            </NavLink>
            <NavLink to="/angebot/neu">Angebot erstellen</NavLink>
            <NavLink to="/so-funktionierts">So funktioniert’s</NavLink>
          </nav>
          <div className="header-actions">
            <PriceChip />
            <AccountMenu />
            <button
              type="button"
              className="icon-btn nav-toggle"
              aria-label={navOpen ? "Menü schließen" : "Menü öffnen"}
              aria-expanded={navOpen}
              onClick={() => setNavOpen((value) => !value)}
            >
              {navOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
      </header>
      <main id="inhalt" className="main">
        {children}
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <div>
            <div className="brand brand-small">
              <Logo size={22} />
              <span className="brand-text">
                CardanoMix <strong>P2P</strong>
              </span>
            </div>
            <p className="muted small">
              Peer-to-Peer-Handel mit ADA. Die ADA liegen während des Handels in einer Treuhand auf der Blockchain, die
              CardanoMix allein nicht bewegen kann; Geld fließt direkt zwischen den Handelspartnern.
            </p>
          </div>
          <nav className="footer-links" aria-label="Fußzeile">
            <Link to="/so-funktionierts">So funktioniert’s</Link>
            <Link to="/rechtliches#risiken">Risikohinweis</Link>
            <Link to="/rechtliches#bedingungen">Nutzungsbedingungen</Link>
            <Link to="/rechtliches#datenschutz">Datenschutz</Link>
            <Link to="/rechtliches#impressum">Impressum</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
