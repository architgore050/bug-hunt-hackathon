import React, { useState } from 'react';
import { api } from '../../lib/api';
import { TopoPanel } from '../../components/TopoPanel';
import { ErrorBanner } from '../../components/ErrorBanner';

export const AdminChallenges: React.FC = () => {
  // Step-up state
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpActive, setStepUpActive] = useState(false);
  const [stepUpError, setStepUpError] = useState<unknown>(null);

  // Challenge authoring state
  const [slug, setSlug] = useState('bug-hunt-vuln-app');
  const [title, setTitle] = useState('Target Vulnerable Service');
  const [challengeId, setChallengeId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [freezeHash, setFreezeHash] = useState<string | null>(null);

  // Test results entry state
  const [subId, setSubId] = useState('');
  const [testsPassed, setTestsPassed] = useState(5);
  const [testsTotal, setTestsTotal] = useState(5);
  const [testResultStatus, setTestResultStatus] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const handleStepUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stepUpPassword) return;

    try {
      setLoading(true);
      setStepUpError(null);
      await api.stepUp(stepUpPassword);
      setStepUpActive(true);
      setStepUpPassword('');
    } catch (err) {
      setStepUpError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      const res = await api.createChallenge('ev-default', { slug, title });
      setChallengeId(res.challenge_id);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeId || !selectedFile) return;

    try {
      setLoading(true);
      setError(null);
      const res = await api.uploadChallengeFile(challengeId, selectedFile);
      setUploadStatus(`Layer ${res.path} charted: ${res.line_count} lines`);
      setSelectedFile(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFreeze = async () => {
    if (!challengeId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.freezeChallenge(challengeId);
      setFreezeHash(res.content_hash);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRecordTests = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeId || !subId) return;
    try {
      setLoading(true);
      setError(null);
      await api.recordTestResults(challengeId, subId, testsPassed, testsTotal);
      setTestResultStatus(
        `Recorded ${testsPassed}/${testsTotal} passing anchors for filing ${subId}`
      );
      setSubId('');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="border-b border-[#22303F] pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="coordinate">GROUND TRUTH DESK // TERRAIN AUTHORING</p>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#E2E8EE] mt-1">
            Challenge authoring & test evidence
          </h1>
        </div>
        <div className="font-mono text-xs">
          <span
            className={`px-3 py-1 font-bold border uppercase tracking-[0.12em] ${
              stepUpActive
                ? 'border-[#3F7A68] bg-[#3F7A68]/10 text-[#63A98D]'
                : 'border-[#C44D3F] bg-[#C44D3F]/10 text-[#E0836F]'
            }`}
          >
            {stepUpActive ? 'STEP-UP ACTIVE (5 MIN)' : 'STEP-UP REQUIRED'}
          </span>
        </div>
      </div>

      {error ? <ErrorBanner error={error} /> : null}

      {!stepUpActive ? (
        <TopoPanel
          sector="GT-00"
          coords="REF: SECURITY ESCALATION"
          title="Confirm elevation"
          subtitle="Terrain authoring and test evidence entry require elevated credentials."
        >
          <form onSubmit={handleStepUp} className="space-y-4 max-w-md font-mono text-xs">
            <p className="text-xs font-sans text-[#7E8FA1] leading-relaxed">
              Confirm your passphrase to open the ground-truth desk. Elevation holds for five
              minutes.
            </p>
            {stepUpError ? <ErrorBanner error={stepUpError} /> : null}
            <div className="space-y-1">
              <label htmlFor="gt-pass" className="coordinate block">
                Passphrase
              </label>
              <input
                id="gt-pass"
                type="password"
                required
                autoComplete="current-password"
                value={stepUpPassword}
                onChange={(e) => setStepUpPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full bg-[#0C1220] border border-[#22303F] px-3 py-2 text-xs text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-[#4A8FA8] text-[#090E16] font-bold uppercase tracking-[0.14em] hover:bg-[#5BA3BC] disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
            >
              {loading ? 'Verifying...' : 'Elevate clearance'}
            </button>
          </form>
        </TopoPanel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <div className="space-y-6">
            <TopoPanel sector="GT-01" coords="REF: AUTHORING" title="Create terrain & chart layers">
              <form onSubmit={handleCreateChallenge} className="space-y-3 font-mono text-xs">
                <div>
                  <label htmlFor="gt-slug" className="coordinate block mb-1">
                    Slug
                  </label>
                  <input
                    id="gt-slug"
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="w-full bg-[#0C1220] border border-[#22303F] px-3 py-1.5 text-xs text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="gt-title" className="coordinate block mb-1">
                    Title
                  </label>
                  <input
                    id="gt-title"
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-[#0C1220] border border-[#22303F] px-3 py-1.5 text-xs text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[#4A8FA8] text-[#090E16] font-bold uppercase tracking-[0.14em] disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
                >
                  Create terrain container
                </button>
              </form>

              {challengeId && (
                <div className="mt-4 pt-4 border-t border-[#22303F] space-y-4 font-mono text-xs">
                  <div className="text-[#63A98D] font-bold">TERRAIN ID: {challengeId}</div>

                  <form onSubmit={handleUploadFile} className="space-y-3">
                    <label htmlFor="gt-file" className="coordinate block">
                      Chart source layer (512 KiB max)
                    </label>
                    <input
                      id="gt-file"
                      type="file"
                      required
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="text-xs text-[#E2E8EE]"
                    />
                    <button
                      type="submit"
                      disabled={loading || !selectedFile}
                      className="px-4 py-1.5 bg-[#1A273A] border border-[#22303F] text-[#E2E8EE] uppercase tracking-[0.12em] hover:bg-[#22334A] disabled:opacity-40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                    >
                      Chart layer
                    </button>
                  </form>

                  {uploadStatus && <div className="text-[#63A98D]">{uploadStatus}</div>}

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleFreeze}
                      disabled={loading}
                      className="px-4 py-2 border border-[#CF824B] text-[#E2A56B] font-bold uppercase tracking-[0.12em] hover:bg-[#CF824B]/10 disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CF824B]"
                    >
                      Freeze terrain (lock ground truth)
                    </button>
                  </div>

                  {freezeHash && (
                    <div className="text-[#63A98D] font-bold break-all">
                      FROZEN CONTENT HASH: {freezeHash.substring(0, 16)}...
                    </div>
                  )}
                </div>
              )}
            </TopoPanel>
          </div>

          <div className="space-y-6">
            <TopoPanel sector="GT-02" coords="REF: TEST RUNNER" title="Record offline test evidence">
              <form onSubmit={handleRecordTests} className="space-y-3 font-mono text-xs">
                <div>
                  <label htmlFor="gt-sub" className="coordinate block mb-1">
                    Filing id
                  </label>
                  <input
                    id="gt-sub"
                    type="text"
                    required
                    value={subId}
                    onChange={(e) => setSubId(e.target.value)}
                    placeholder="sub-..."
                    className="w-full bg-[#0C1220] border border-[#22303F] px-3 py-1.5 text-xs text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="gt-passed" className="coordinate block mb-1">
                      Anchors passed
                    </label>
                    <input
                      id="gt-passed"
                      type="number"
                      min={0}
                      value={testsPassed}
                      onChange={(e) => setTestsPassed(parseInt(e.target.value))}
                      className="w-full bg-[#0C1220] border border-[#22303F] px-3 py-1.5 text-xs text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="gt-total" className="coordinate block mb-1">
                      Anchors total
                    </label>
                    <input
                      id="gt-total"
                      type="number"
                      min={1}
                      value={testsTotal}
                      onChange={(e) => setTestsTotal(parseInt(e.target.value))}
                      className="w-full bg-[#0C1220] border border-[#22303F] px-3 py-1.5 text-xs text-[#E2E8EE] focus:border-[#4A8FA8] focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[#3F7A68] text-white font-bold uppercase tracking-[0.14em] disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4A8FA8]"
                >
                  Record test evidence
                </button>
              </form>

              {testResultStatus && (
                <div className="mt-3 pt-3 border-t border-[#22303F] font-mono text-xs text-[#63A98D] font-bold">
                  {testResultStatus}
                </div>
              )}
            </TopoPanel>
          </div>
        </div>
      )}
    </div>
  );
};
