import { lazy, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { Spinner } from './components/ui.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { Settings } from './pages/admin/Settings.tsx';
import { Users } from './pages/admin/Users.tsx';
import { Login } from './pages/Login.tsx';
import { TicketView } from './pages/TicketView.tsx';
import { MyTickets } from './pages/user/MyTickets.tsx';
import { NewTicket } from './pages/user/NewTicket.tsx';

// Heavier screens (markdown, uploads, drag and drop) load on first visit.
const Board = lazy(() => import('./pages/admin/Board.tsx').then((m) => ({ default: m.Board })));
const Links = lazy(() => import('./pages/admin/Links.tsx').then((m) => ({ default: m.Links })));
const Media = lazy(() => import('./pages/admin/Media.tsx').then((m) => ({ default: m.Media })));
const WikiIndex = lazy(() => import('./pages/wiki/Wiki.tsx').then((m) => ({ default: m.WikiIndex })));
const WikiView = lazy(() => import('./pages/wiki/Wiki.tsx').then((m) => ({ default: m.WikiView })));
const WikiEdit = lazy(() => import('./pages/wiki/WikiEdit.tsx').then((m) => ({ default: m.WikiEdit })));

/** Signed-out visitors see the login screen on any URL. */
function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  return user ? <Layout /> : <Login />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'admin' ? children : <Navigate to="/new" replace />;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'admin' ? '/admin' : '/new'} replace />;
}

const admin = (el: ReactNode) => <AdminOnly>{el}</AdminOnly>;

// A data router, so the wiki editor can warn before leaving with unsaved changes.
const router = createBrowserRouter([
  {
    element: <Gate />,
    children: [
      { path: '/new', element: <NewTicket /> },
      { path: '/requests', element: <MyTickets /> },
      { path: '/requests/:id', element: <TicketView /> },
      { path: '/wiki', element: <WikiIndex /> },
      { path: '/wiki/new', element: admin(<WikiEdit />) },
      { path: '/wiki/:slug', element: <WikiView /> },
      { path: '/wiki/:slug/edit', element: admin(<WikiEdit />) },
      { path: '/admin', element: admin(<Board />) },
      { path: '/admin/media', element: admin(<Media />) },
      { path: '/admin/links', element: admin(<Links />) },
      { path: '/admin/users', element: admin(<Users />) },
      { path: '/admin/settings', element: admin(<Settings />) },
      { path: '*', element: <Home /> },
    ],
  },
]);

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>
  );
}
