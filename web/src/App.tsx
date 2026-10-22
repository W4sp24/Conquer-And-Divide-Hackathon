import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Spinner } from './components/ui'
import { SellerLayout, SellerHome } from './seller/SellerLayout'

const Sessions = lazy(() => import('./seller/Sessions'))
const LiveBoard = lazy(() => import('./seller/LiveBoard'))
const Payments = lazy(() => import('./seller/Payments'))
const Packing = lazy(() => import('./seller/Packing'))
const Insights = lazy(() => import('./seller/Insights'))
const Catalog = lazy(() => import('./seller/Catalog'))
const Buyers = lazy(() => import('./seller/Buyers'))
const Settings = lazy(() => import('./seller/Settings'))
const BuyerOrder = lazy(() => import('./public/BuyerOrder'))
const PayQR = lazy(() => import('./public/PayQR'))
const Wallet = lazy(() => import('./public/Wallet'))
const Viewer = lazy(() => import('./public/Viewer'))

function Loading() {
  return <div className="grid min-h-[60vh] place-items-center text-muted"><Spinner size={22} /></div>
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Navigate to="/seller" replace />} />
        <Route path="/seller" element={<SellerLayout />}>
          <Route index element={<SellerHome />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="live/:sid" element={<LiveBoard />} />
          <Route path="payments" element={<Payments />} />
          <Route path="packing" element={<Packing />} />
          <Route path="insights" element={<Insights />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="buyers" element={<Buyers />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="/o/:token" element={<BuyerOrder />} />
        <Route path="/pay/:intentId" element={<PayQR />} />
        <Route path="/w/:sellerId" element={<Wallet />} />
        <Route path="/live/:sid" element={<Viewer />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}

function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <h1 className="text-[26px] font-bold">This page doesn’t exist</h1>
        <p className="mt-1 text-muted">Check the link, or ask the seller to send it again.</p>
      </div>
    </div>
  )
}
