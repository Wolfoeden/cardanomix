import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Me } from "../shared/types";
import { api, errorMessage } from "./api";
import { CopyButton, Modal } from "./components/Ui";
import { useConfig } from "./hooks";
import { enableWallet, lastWallet, listWallets, rememberWallet, utf8ToHex, walletErrorMessage, type WalletInfo } from "./wallet";

interface AuthState {
  me: Me | null;
  ready: boolean;
  /** Öffnet den Wallet-Dialog; das Promise erfüllt sich nach erfolgreicher Anmeldung. */
  requireLogin: () => Promise<Me>;
  openLogin: () => void;
  logout: () => Promise<void>;
  setMe: (me: Me) => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth außerhalb des AuthProvider");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [waiters, setWaiters] = useState<{ resolve: (me: Me) => void; reject: (error: Error) => void }[]>([]);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setMe(user);
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requireLogin = useCallback(() => {
    if (me) return Promise.resolve(me);
    return new Promise<Me>((resolve, reject) => {
      setWaiters((current) => [...current, { resolve, reject }]);
      setDialogOpen(true);
    });
  }, [me]);

  const finish = useCallback(
    (user: Me | null) => {
      setDialogOpen(false);
      if (user) {
        setMe(user);
        waiters.forEach((waiter) => waiter.resolve(user));
      } else {
        waiters.forEach((waiter) => waiter.reject(new Error("Anmeldung abgebrochen.")));
      }
      setWaiters([]);
    },
    [waiters],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setMe(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ me, ready, requireLogin, openLogin: () => setDialogOpen(true), logout, setMe, refresh }),
    [me, ready, requireLogin, logout, refresh],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {dialogOpen && <WalletDialog onDone={finish} />}
    </AuthContext.Provider>
  );
}

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function WalletDialog({ onDone }: { onDone: (me: Me | null) => void }) {
  const config = useConfig();
  const [wallets, setWallets] = useState<WalletInfo[]>(() => listWallets());
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Manche Wallets registrieren sich erst kurz nach dem Laden der Seite.
    const timer = window.setTimeout(() => setWallets(listWallets()), 600);
    return () => window.clearTimeout(timer);
  }, []);

  const preferred = lastWallet();

  async function connect(wallet: WalletInfo) {
    setBusy(wallet.key);
    setError(null);
    try {
      setStep("Verbindung zur Wallet bestätigen …");
      const walletApi = await enableWallet(wallet.key);
      const networkId = await walletApi.getNetworkId();
      if (config && networkId !== config.networkId) {
        throw new Error(
          config.network === "mainnet"
            ? "Deine Wallet ist auf ein Testnetz eingestellt. Bitte auf das Cardano-Mainnet umstellen."
            : "Deine Wallet ist auf das Mainnet eingestellt. Bitte auf das Preprod-Testnetz umstellen.",
        );
      }
      const [rewardAddresses, changeAddress] = await Promise.all([
        walletApi.getRewardAddresses().catch(() => [] as string[]),
        walletApi.getChangeAddress(),
      ]);
      const signingAddress = rewardAddresses[0] ?? changeAddress;
      const challenge = await api.challenge();
      setStep("Anmeldung in der Wallet signieren …");
      let signed: { signature: string; key: string };
      try {
        signed = await walletApi.signData(signingAddress, utf8ToHex(challenge.message));
      } catch (err) {
        throw new Error(walletErrorMessage(err, "Signatur fehlgeschlagen."));
      }
      setStep("Signatur wird geprüft …");
      const { user } = await api.login({ nonce: challenge.nonce, ...signed, receiveAddress: changeAddress });
      rememberWallet(wallet.key);
      onDone(user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
      setStep("");
    }
  }

  return (
    <Modal title="Mit Wallet anmelden" onClose={() => onDone(null)}>
      <p className="muted">
        Wähle deine Cardano-Wallet. Zur Anmeldung signierst du eine kurze Nachricht – dabei wird keine Transaktion
        ausgelöst und nichts bezahlt.
      </p>
      {wallets.length === 0 && isMobile() ? (
        <div className="notice notice-warn">
          <p>
            <strong>Auf dem Smartphone gibt es keine Browser-Erweiterungen.</strong> Öffne diese Seite im integrierten
            Browser deiner Wallet-App – zum Beispiel Eternl, Vespr, Yoroi oder Begin – und melde dich dort an.
          </p>
          <CopyButton value={window.location.href} label="Link für die Wallet-App kopieren" />
        </div>
      ) : wallets.length === 0 ? (
        <div className="notice notice-warn">
          <strong>Keine Cardano-Wallet gefunden.</strong> Installiere eine Browser-Wallet wie{" "}
          <a href="https://eternl.io" target="_blank" rel="noreferrer">
            Eternl
          </a>
          ,{" "}
          <a href="https://www.lace.io" target="_blank" rel="noreferrer">
            Lace
          </a>{" "}
          oder{" "}
          <a href="https://vespr.xyz" target="_blank" rel="noreferrer">
            Vespr
          </a>{" "}
          und lade die Seite neu.
        </div>
      ) : (
        <ul className="wallet-list">
          {wallets.map((wallet) => (
            <li key={wallet.key}>
              <button
                type="button"
                className="wallet-option"
                disabled={busy !== null}
                onClick={() => void connect(wallet)}
                data-wallet={wallet.key}
              >
                {wallet.icon ? <img src={wallet.icon} alt="" width={28} height={28} /> : <span className="wallet-icon-fallback" />}
                <span>{wallet.name}</span>
                {preferred === wallet.key && <span className="badge">zuletzt genutzt</span>}
                {busy === wallet.key && <span className="spinner" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {step && (
        <p className="muted" role="status">
          {step}
        </p>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
