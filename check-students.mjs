import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'

const sa = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'))
initializeApp({ credential: cert(sa) })
const db = getFirestore()

const snap = await db.collection('students').get()
console.log('Total student docs:', snap.size)

const byClass = {}
const byBranch = {}
snap.forEach(d => {
  const s = d.data()
  const c = s.className || '(missing)'
  const b = s.branchCode || '(missing)'
  byClass[c] = (byClass[c] || 0) + 1
  byBranch[b] = (byBranch[b] || 0) + 1
})

console.log('\nBy className:')
Object.entries(byClass).sort().forEach(([k, v]) => console.log('  ' + k + ': ' + v))

console.log('\nBy branchCode:')
Object.entries(byBranch).forEach(([k, v]) => console.log('  ' + k + ': ' + v))

process.exit(0)
