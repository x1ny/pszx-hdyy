import { Routes, Route } from 'react-router'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'

// Single-page H5: only the `/` route exists (no route jumps per product spec).
// Layout uses the CHILDREN pattern — routes are wrapped, not nested.
export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </Layout>
  )
}
