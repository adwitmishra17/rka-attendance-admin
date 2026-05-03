import React, { useState, useEffect, createContext, useContext } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './lib/firebase'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import EmployeeProfile from './pages/EmployeeProfile'
import Attendance from './pages/Attendance'
import Holidays from './pages/Holidays'
import ReportingTime from './pages/ReportingTime'
import FaceEnrollment from './pages/FaceEnrollment'
import Departments from './pages/Departments'
import WalkIns from './pages/WalkIns'
import WalkInDetail from './pages/WalkInDetail'
import RecruitmentTags from './pages/RecruitmentTags'

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--gray-50)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{
      user,
      adminRole,
      isSuperAdmin: adminRole === 'super_admin',
      isAdmin: adminRole === 'admin' || adminRole === 'super_admin',
      isReceptionist: adminRole === 'receptionist',
    }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login authError={authError} />} />
        <Route path="/" element={user ? <Layout /> : <Navigate to="/login" />}>
          {/* Receptionists land on walkins; everyone else lands on dashboard */}
          <Route index element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <Dashboard />} />
          <Route path="employees" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <Employees />} />
          <Route path="employees/:id" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <EmployeeProfile />} />
          <Route path="attendance" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <Attendance />} />
          <Route path="holidays" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <Holidays />} />
          <Route path="reporting-time" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <ReportingTime />} />
          <Route path="face-enrollment" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <FaceEnrollment />} />
          <Route path="departments" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <Departments />} />
          {/* Walk-ins — accessible to admin AND receptionist */}
          <Route path="walkins" element={<WalkIns />} />
          <Route path="walkins/:id" element={<WalkInDetail />} />
          <Route path="recruitment-tags" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <RecruitmentTags />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AuthContext.Provider>
  )
}
