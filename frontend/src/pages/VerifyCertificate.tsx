import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

type VerificationResult = {
  valid: boolean
  certificate_id: string
  recipient_name: string
  course_id: string
  course_title: string
  category: string
  difficulty: string
  issued_at: string
  issuer: string
  verification_url: string
}

export function VerifyCertificate() {
  const { certificateId } = useParams<{ certificateId: string }>()
  const [data, setData] = useState<VerificationResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function verify() {
      if (!certificateId) {
        setError('Missing certificate ID')
        setLoading(false)
        return
      }
      try {
        const res = await fetch(`/api/v1/certificates/${certificateId}/verify`)
        if (!res.ok) {
          throw new Error('This certificate ID could not be found or verified in our registry.')
        }
        const json = await res.json()
        if (!cancelled) {
          setData(json)
          setLoading(false)
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Verification failed')
          setLoading(false)
        }
      }
    }
    void verify()
    return () => { cancelled = true }
  }, [certificateId])

  const copyId = () => {
    if (certificateId) {
      navigator.clipboard.writeText(certificateId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const downloadPdf = async () => {
    if (!certificateId) return
    const res = await fetch(`/api/v1/certificates/${certificateId}/public-download`)
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `verified-certificate-${certificateId.slice(0, 8)}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto w-full">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 no-underline text-slate-900 dark:text-slate-100">
            <span className="w-9 h-9 rounded-xl bg-indigo-600 text-white font-extrabold flex items-center justify-center text-lg shadow-sm">
              V
            </span>
            <span className="text-xl font-black tracking-tight">VertexLearn AI</span>
          </Link>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-widest font-semibold">
            Official Credential Verification Registry
          </p>
        </div>

        {loading ? (
          <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm text-center">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Verifying academic credential signature…</p>
          </div>
        ) : error || !data ? (
          <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-rose-200 dark:border-rose-900/60 shadow-sm text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold text-xl mx-auto mb-4 border border-rose-200 dark:border-rose-800">
              ✕
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Unverified Credential</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 max-w-md mx-auto">
              {error || 'This certificate identifier could not be validated against our cryptographic ledger.'}
            </p>
            <Link to="/" className="inline-flex items-center px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold no-underline">
              Return to Catalog
            </Link>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-lg overflow-hidden">
            {/* Authenticity Banner */}
            <div className="bg-emerald-600 text-white px-6 py-3.5 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-200" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-xs font-bold uppercase tracking-wider">Authentic Academic Credential</span>
              </div>
              <span className="text-[11px] font-semibold bg-emerald-700/80 px-2 py-0.5 rounded text-emerald-100">
                Verified Cryptographically
              </span>
            </div>

            {/* Certificate Body */}
            <div className="p-8 space-y-6">
              <div className="text-center pb-6 border-b border-slate-100 dark:border-slate-800">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1 block">
                  Certificate of Completion
                </span>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mb-2">
                  {data.course_title}
                </h1>
                <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 capitalize">
                  {data.category} · {data.difficulty}
                </span>
              </div>

              {/* Recipient Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                    Awarded To
                  </span>
                  <span className="text-base font-bold text-slate-900 dark:text-slate-100 block">
                    {data.recipient_name}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                    Issue Date
                  </span>
                  <span className="text-base font-bold text-slate-900 dark:text-slate-100 block">
                    {new Date(data.issued_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                </div>
              </div>

              {/* Credential ID */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between gap-3">
                <div className="overflow-hidden">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                    Credential Unique ID
                  </span>
                  <span className="font-mono text-xs text-slate-800 dark:text-slate-200 truncate block">
                    {data.certificate_id}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={copyId}
                  className="secondary text-xs py-1.5 px-3 shrink-0"
                >
                  {copied ? 'Copied!' : 'Copy ID'}
                </button>
              </div>

              {/* Issuer Authority */}
              <div className="flex items-center justify-between pt-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Issuer: <strong>{data.issuer}</strong></span>
                <span>Status: <span className="text-emerald-600 font-semibold">Active & Valid</span></span>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={downloadPdf}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Verified PDF
                </button>
                <Link to="/courses" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                  Browse Verified Curricula &rarr;
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="text-center text-xs text-slate-400 dark:text-slate-600 mt-8">
        &copy; {new Date().getFullYear()} VertexLearn AI &middot; Tamper-evident learning credential authority
      </div>
    </div>
  )
}

