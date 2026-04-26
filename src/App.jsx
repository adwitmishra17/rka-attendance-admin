import React, { useState, useEffect, createContext, useContext } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './lib/firebase'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import Attendance from './pages/Attendance'
import Holidays from './pages/Holidays'
import ReportingTime from './pages/ReportingTime'
import FaceEnrollment from './pages/FaceEnrollment'

export const SUPER_ADMIN_EMAIL = 'adwit@rkacademyballia.in'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export default function App() {
  const [user, setUser] = useState(null)
  const [adminRole, setAdminRole] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setAuthError('')
      if (!u) {
        setUser(null)
        setAdminRole(null)
        setAuthLoading(false)
        return
      }

      const email = (u.email || '').toLowerCase()

      // Hardcoded super admin
      if (email === SUPER_ADMIN_EMAIL) {
        setUser(u)
        setAdminRole('super_admin')
        setAuthLoading(false)
        return
      }

      // Check admins collection in existing rka-academic-tracker Firestore
      try {
        const adminDoc = await getDoc(doc(db, 'admins', email))
        if (adminDoc.exists()) {
          const data = adminDoc.data()
          if (data.isActive === false) {
            setAuthError('Your admin access has been deactivated. Contact Adwit Mishra.')
            await signOut(auth)
            setAuthLoading(false)
            return
          }
          setUser(u)
          setAdminRole(data.role || 'admin')
          setAuthLoading(false)
        } else {
          setAuthError('You are not authorised to access the admin portal. Contact Adwit Mishra.')
          await signOut(auth)
          setAuthLoading(false)
        }
      } catch (e) {
        console.error('Admin check failed:', e)
        setAuthError('Could not verify admin access. Please try again.')
        await signOut(auth)
        setAuthLoading(false)
      }
    })

    return () => unsub()
  }, [])

  if (authLoading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--gray-50)' }}>
        <div style={{ width:36, height:36, border:'3px solid var(--green-muted)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{
      user,
      adminRole,
      isSuperAdmin: adminRole === 'super_admin',
      isAdmin: adminRole === 'admin' || adminRole === 'super_admin',
    }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login authError={authError} />} />
        <Route path="/" element={user ? <Layout /> : <Navigate to="/login" />}>
          <Route index element={<Dashboard />} />
          <Route path="employees" element={<Employees />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="holidays" element={<Holidays />} />
          <Route path="reporting-time" element={<ReportingTime />} />
          <Route path="face-enrollment" element={<FaceEnrollment />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AuthContext.Provider>
  )
}
