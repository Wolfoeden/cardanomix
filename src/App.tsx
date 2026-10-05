import { BrowserRouter, Link, Route, Routes } from "react-router";
import { AuthProvider } from "./auth";
import { Layout } from "./components/Layout";
import { AccountPage } from "./pages/Account";
import { AdminPage } from "./pages/Admin";
import { CreateOfferPage } from "./pages/CreateOffer";
import { HowItWorksPage } from "./pages/HowItWorks";
import { LegalPage } from "./pages/Legal";
import { MarketPage } from "./pages/Market";
import { OfferDetailPage } from "./pages/OfferDetail";
import { ProfilePage } from "./pages/Profile";
import { TradeRoomPage } from "./pages/TradeRoom";
import { useDocumentTitle } from "./hooks";
import { MarketplacePage } from "./pages/Marketplace";
import { ListingEditorPage } from "./pages/ListingEditor";
import { ListingDetailPage } from "./pages/ListingDetail";
import { OrderPage } from "./pages/Order";
import { MessagesPage } from "./pages/Messages";

function NotFoundPage() {
  useDocumentTitle("Nicht gefunden");
  return (
    <div className="container section narrow">
      <h1>Seite nicht gefunden</h1>
      <p className="muted">Diese Seite gibt es nicht (mehr).</p>
      <Link to="/" className="btn btn-primary">
        Zum Marktplatz
      </Link>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<MarketplacePage />} />
            <Route path="/ada-handeln" element={<MarketPage />} />
            <Route path="/marktplatz/angebot/neu" element={<ListingEditorPage />} />
            <Route path="/marktplatz/angebot/:id" element={<ListingDetailPage />} />
            <Route path="/marktplatz/angebot/:id/bearbeiten" element={<ListingEditorPage />} />
            <Route path="/bestellung/:id" element={<OrderPage />} />
            <Route path="/nachrichten/:id" element={<MessagesPage />} />
            <Route path="/angebot/neu" element={<CreateOfferPage />} />
            <Route path="/angebot/:id" element={<OfferDetailPage />} />
            <Route path="/handel/:id" element={<TradeRoomPage />} />
            <Route path="/konto" element={<AccountPage />} />
            <Route path="/nutzer/:id" element={<ProfilePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/so-funktionierts" element={<HowItWorksPage />} />
            <Route path="/rechtliches" element={<LegalPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Layout>
      </AuthProvider>
    </BrowserRouter>
  );
}
