import React, { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './lib/firebase'
import {
  BRANCH_CODES,
  readStoredBranch,
  writeStoredBranch,
  resolveBranch,
  effectiveBranches as computeEffectiveBranches,
} from './lib/branch'
import { adminModules } from './lib/admins'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import EmployeeProfile from './pages/EmployeeProfile'
import Attendance from './pages/Attendance'
import MonthlyReport from './pages/MonthlyReport'
import Holidays from './pages/Holidays'
import ReportingTime from './pages/ReportingTime'
import FaceEnrollment from './pages/FaceEnrollment'
import Departments from './pages/Departments'
import WalkIns from './pages/WalkIns'
import WalkInDetail from './pages/WalkInDetail'
import RecruitmentTags from './pages/RecruitmentTags'
import AdminUsers from './pages/AdminUsers'
import MonthlyReport from './pages/MonthlyReport'

export const SUPER_ADMIN_EMAIL = 'adwit@rkacademyballia.in'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export default function App() {
  const [user, setUser] = useState(null)
  const [adminRole, setAdminRole] = useState(null)
  const [allowedBranches, setAllowedBranches] = useState([])
  const [currentBranch, setCurrentBranchState] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setAuthError('')
      if (!u) {
        setUser(null)
        setAdminRole(null)
        setAllowedBranches([])
        setCurrentBranchState(null)
        setAuthLoading(false)
        return
      }

      const email = (u.email || '').toLowerCase()

      if (email === SUPER_ADMIN_EMAIL) {
        const allowed = ['MAIN', 'CITY']
        setUser(u)
        setAdminRole('super_admin')
        setAllowedBranches(allowed)
        setCurrentBranchState(resolveBranch(readStoredBranch(), allowed))
        setAuthLoading(false)
        return
      }

      try {
        const adminDoc = await getDoc(doc(db, 'admins', email))
        if (!adminDoc.exists()) {
          setAuthError('You are not authorised to access the admin portal. Contact Adwit Mishra.')
          await signOut(auth)
          setAuthLoading(false)
          return
        }
        const data = adminDoc.data()
        if (data.isActive === false) {
          setAuthError('Your admin access has been deactivated. Contact Adwit Mishra.')
          await signOut(auth)
          setAuthLoading(false)
          return
        }

        // Module gate: this is the HRMS app, so 'hrms' must be in the
        // admin's allowed modules. Legacy docs missing the field default
        // to both modules (handled by adminModules helper).
        const mods = adminModules(data)
        if (!mods.includes('hrms')) {
          setAuthError('You don\'t have access to the HRMS portal. Contact Adwit Mishra.')
          await signOut(auth)
          setAuthLoading(false)
          return
        }

        let allowed
        if (BRANCH_CODES.includes(data.branchCode)) {
          allowed = [data.branchCode]
        } else {
          console.warn(`Admin ${email} has missing/invalid branchCode (${data.branchCode}); defaulting to MAIN`)
          allowed = ['MAIN']
        }

        setUser(u)
        setAdminRole(data.role || 'admin')
        setAllowedBranches(allowed)
        setCurrentBranchState(resolveBranch(readStoredBranch(), allowed))
        setAuthLoading(false)
      } catch (e) {
        console.error('Admin check failed:', e)
        setAuthError('Could not verify admin access. Please try again.')
        await signOut(auth)
        setAuthLoading(false)
      }
    })

    return () => unsub()
  }, [])

  const setCurrentBranch = useCallback((next) => {
    if (next === null) {
      if (allowedBranches.length > 1) {
        setCurrentBranchState(null)
        writeStoredBranch(null)
      }
      return
    }
    if (allowedBranches.includes(next)) {
      setCurrentBranchState(next)
      writeStoredBranch(next)
    }
  }, [allowedBranches])

  // Memoise effectiveBranches so its array identity is stable across renders.
  const effectiveBranches = useMemo(
    () => computeEffectiveBranches(currentBranch, allowedBranches),
    [currentBranch, allowedBranches]
  )

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
      allowedBranches,
      currentBranch,
      setCurrentBranch,
      effectiveBranches,
      canSwitchBranches: allowedBranches.length > 1,
    }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login authError={authError} />} />
        <Route path="/" element={user ? <Layout /> : <Navigate to="/login" />}>
          <Route index element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <Dashboard />} />
          <Route path="employees" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <Employees />} />
          <Route path="employees/:id" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <EmployeeProfile />} />
          <Route path="attendance" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <Attendance />} />
          <Route path="reports/monthly" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <MonthlyReport />} />
          <Route path="holidays" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <Holidays />} />
          <Route path="reporting-time" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <ReportingTime />} />
          <Route path="face-enrollment" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <FaceEnrollment />} />
          <Route path="departments" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <Departments />} />
          <Route path="walkins" element={<WalkIns />} />
          <Route path="walkins/:id" element={<WalkInDetail />} />
          <Route path="recruitment-tags" element={adminRole === 'receptionist' ? <Navigate to="/walkins" replace /> : <RecruitmentTags />} />
          <Route path="admin-users" element={adminRole === 'super_admin' ? <AdminUsers /> : <Navigate to="/" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AuthContext.Provider>
  )
}
