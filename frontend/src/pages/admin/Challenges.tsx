import React, { useState } from 'react';
import { api } from '../../lib/api';
import { ExhibitCard } from '../../components/ExhibitCard';
import { ErrorBanner } from '../../components/ErrorBanner';

export const AdminChallenges: React.FC = () => {
  // Step-up state
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpActive, setStepUpActive] = useState(false);
  const [stepUpError, setStepUpError] = useState<unknown>(null);

  // Challenge Authoring State
  const [slug, setSlug] = useState('bug-hunt-vuln-app');
  const [title, setTitle] = useState('Target Vulnerable Service');
  const [challengeId, setChallengeId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [freezeHash, setFreezeHash] = useState<string | null>(null);

  // Test Results Entry State
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
      // Hardcoded event id fallback or default
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
      setUploadStatus(`File ${res.path} uploaded successfully (${res.line_count} lines)`);
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
      setTestResultStatus(`Recorded test results for submission ${subId}: ${testsPassed}/${testsTotal} passed`);
      setSubId('');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-[#2B2E35] pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#C04A36]" />
            <span className="text-xs font-mono uppercase tracking-widest text-[#CF8B38]">
              CHALLENGE DESK // GROUND TRUTH TOOLS
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-black text-[#ECEEF2] mt-1">
            Challenge Authoring & Test Results Entry
          </h1>
        </div>

        <div className="font-mono text-xs">
          <span
            className={`px-3 py-1 font-bold border ${
              stepUpActive
                ? 'border-[#3E7259] bg-[#3E7259]/10 text-[#3E7259]'
                : 'border-[#C04A36] bg-[#C04A36]/10 text-[#C04A36]'
            }`}
          >
            {stepUpActive ? 'STEP-UP ACTIVE (5 MIN)' : 'STEP-UP RE-AUTH REQUIRED'}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error ? <ErrorBanner error={error} /> : null}

      {/* Step-up Re-auth Panel */}
      {!stepUpActive ? (
        <ExhibitCard
          exhibitNumber="AUTH-09"
          category="SECURITY ESCALATION"
          title="Step-Up Password Confirmation Required"
          variant="buff"
        >
          <form onSubmit={handleStepUp} className="space-y-4 max-w-md font-mono text-xs">
            <p className="text-xs font-sans text-[#6A665D]">
              Challenge versioning and test result entry require elevated credentials. Confirm your administrator passphrase to continue.
            </p>
            {stepUpError ? <ErrorBanner error={stepUpError} /> : null}
            <div className="space-y-1">
              <label className="block text-[#181A1F] font-bold uppercase">Passphrase</label>
              <input
                type="password"
                required
                value={stepUpPassword}
                onChange={(e) => setStepUpPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full bg-[#EBE6DB] border border-[#DDD7CA] px-3 py-2 text-xs text-[#181A1F] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-[#C04A36] text-[#ECEEF2] font-bold uppercase hover:bg-[#A83827] transition-colors"
            >
              {loading ? 'Verifying...' : 'Authenticate Elevated Clearance'}
            </button>
          </form>
        </ExhibitCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Challenge Creation & Files */}
          <div className="space-y-6">
            <ExhibitCard
              exhibitNumber="EX-01"
              category="AUTHORING"
              title="Create Challenge Version & Upload Files"
            >
              <form onSubmit={handleCreateChallenge} className="space-y-3 font-mono text-xs">
                <div>
                  <label className="block text-[#868A94] uppercase mb-1">Slug</label>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="w-full bg-[#111215] border border-[#2B2E35] px-3 py-1.5 text-xs text-[#ECEEF2]"
                  />
                </div>
                <div>
                  <label className="block text-[#868A94] uppercase mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-[#111215] border border-[#2B2E35] px-3 py-1.5 text-xs text-[#ECEEF2]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[#C04A36] text-[#ECEEF2] font-bold uppercase"
                >
                  Create Challenge Container
                </button>
              </form>

              {challengeId && (
                <div className="pt-4 border-t border-[#2B2E35] space-y-4 font-mono text-xs">
                  <div className="text-[#3E7259] font-bold">CHALLENGE ID: {challengeId}</div>

                  <form onSubmit={handleUploadFile} className="space-y-3">
                    <label className="block text-[#868A94] uppercase">Upload Source File (512 KiB Max)</label>
                    <input
                      type="file"
                      required
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="text-xs text-[#ECEEF2]"
                    />
                    <button
                      type="submit"
                      disabled={loading || !selectedFile}
                      className="px-4 py-1.5 bg-[#2B2E35] text-[#ECEEF2] uppercase hover:bg-[#3C404A]"
                    >
                      Upload File
                    </button>
                  </form>

                  {uploadStatus && <div className="text-[#3E7259]">{uploadStatus}</div>}

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleFreeze}
                      disabled={loading}
                      className="px-4 py-2 border border-[#CF8B38] text-[#CF8B38] font-bold uppercase hover:bg-[#CF8B38]/10"
                    >
                      Freeze Version (Lock Ground Truth)
                    </button>
                  </div>

                  {freezeHash && (
                    <div className="text-[#3E7259] font-bold">
                      FROZEN CONTENT HASH: {freezeHash.substring(0, 16)}...
                    </div>
                  )}
                </div>
              )}
            </ExhibitCard>
          </div>

          {/* Test Results Entry */}
          <div className="space-y-6">
            <ExhibitCard
              exhibitNumber="EX-02"
              category="TEST RUNNER"
              title="Record Offline Test Suite Results"
            >
              <form onSubmit={handleRecordTests} className="space-y-3 font-mono text-xs">
                <div>
                  <label className="block text-[#868A94] uppercase mb-1">Submission ID</label>
                  <input
                    type="text"
                    required
                    value={subId}
                    onChange={(e) => setSubId(e.target.value)}
                    placeholder="sub-..."
                    className="w-full bg-[#111215] border border-[#2B2E35] px-3 py-1.5 text-xs text-[#ECEEF2]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[#868A94] uppercase mb-1">Tests Passed</label>
                    <input
                      type="number"
                      min={0}
                      value={testsPassed}
                      onChange={(e) => setTestsPassed(parseInt(e.target.value))}
                      className="w-full bg-[#111215] border border-[#2B2E35] px-3 py-1.5 text-xs text-[#ECEEF2]"
                    />
                  </div>
                  <div>
                    <label className="block text-[#868A94] uppercase mb-1">Tests Total</label>
                    <input
                      type="number"
                      min={1}
                      value={testsTotal}
                      onChange={(e) => setTestsTotal(parseInt(e.target.value))}
                      className="w-full bg-[#111215] border border-[#2B2E35] px-3 py-1.5 text-xs text-[#ECEEF2]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[#3E7259] text-[#ECEEF2] font-bold uppercase hover:bg-[#34614A]"
                >
                  Submit Test Score
                </button>
              </form>

              {testResultStatus && (
                <div className="pt-3 font-mono text-xs text-[#3E7259] font-bold">
                  {testResultStatus}
                </div>
              )}
            </ExhibitCard>
          </div>
        </div>
      )}
    </div>
  );
};
