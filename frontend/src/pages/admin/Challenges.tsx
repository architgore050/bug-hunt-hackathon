import React, { useState } from 'react';
import { api } from '../../lib/api';
import { InstrumentRack } from '../../components/InstrumentRack';
import { ErrorBanner } from '../../components/ErrorBanner';

export const AdminChallenges: React.FC = () => {
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpActive, setStepUpActive] = useState(false);
  const [stepUpError, setStepUpError] = useState<unknown>(null);

  const [slug, setSlug] = useState('bug-hunt-vuln-app');
  const [title, setTitle] = useState('Target Vulnerable Service');
  const [challengeId, setChallengeId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [freezeHash, setFreezeHash] = useState<string | null>(null);

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
      setUploadStatus(`Uploaded ${res.path} (${res.line_count} lines)`);
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
      setTestResultStatus(`Committed test results for ${subId}: ${testsPassed}/${testsTotal} passed`);
      setSubId('');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="border-b border-[#2D333D] pb-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#E5A83B]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#E5A83B] font-bold">
              GROUND TRUTH // CHALLENGE MATRIX
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black uppercase text-[#EAECE8] tracking-tight mt-1">
            Challenge Container Authoring & Offline Test Scoring
          </h1>
        </div>

        <div className="font-mono text-xs">
          <span
            className={`px-3 py-1 font-bold border ${
              stepUpActive
                ? 'border-[#437A55] bg-[#437A55]/10 text-[#5FA57F]'
                : 'border-[#BD3A3A] bg-[#BD3A3A]/10 text-[#D96A5F]'
            }`}
          >
            {stepUpActive ? 'STEP-UP RE-AUTH ACTIVE (5 MIN)' : 'STEP-UP ELEVATION REQUIRED'}
          </span>
        </div>
      </div>

      {error ? <ErrorBanner error={error} /> : null}

      {!stepUpActive ? (
        <InstrumentRack
          channel="AUTH-09"
          title="Elevated Operator Re-Authentication Required"
          telemetryTag="SECURITY GATE"
        >
          <form onSubmit={handleStepUp} className="space-y-4 max-w-md font-mono text-xs">
            <p className="text-xs font-sans text-[#7F8896]">
              Target binary uploads and ground-truth score commits require elevated administrative credentials. Confirm your master password.
            </p>
            {stepUpError ? <ErrorBanner error={stepUpError} /> : null}
            <div className="space-y-1">
              <label className="block text-[#EAECE8] uppercase font-bold text-[10px]">Passphrase</label>
              <input
                type="password"
                required
                value={stepUpPassword}
                onChange={(e) => setStepUpPassword(e.target.value)}
                placeholder="Confirm administrator passphrase"
                className="w-full bg-[#101216] border border-[#2D333D] px-3 py-2 text-xs text-[#EAECE8] focus:border-[#E5A83B] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-[#E5A83B] text-[#0E1013] font-bold uppercase hover:bg-[#D4982B] transition-colors"
            >
              {loading ? 'Authenticating...' : 'Authenticate Elevated Clearance'}
            </button>
          </form>
        </InstrumentRack>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <InstrumentRack
            channel="AUTHORING-01"
            title="Create Challenge Container & Upload Modules"
            telemetryTag="FIRMWARE LOADER"
          >
            <form onSubmit={handleCreateChallenge} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[#7F8896] uppercase text-[10px] mb-1">Slug</label>
                <input
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full bg-[#101216] border border-[#2D333D] px-2.5 py-1.5 text-xs text-[#EAECE8]"
                />
              </div>
              <div>
                <label className="block text-[#7F8896] uppercase text-[10px] mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-[#101216] border border-[#2D333D] px-2.5 py-1.5 text-xs text-[#EAECE8]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-[#E5A83B] text-[#0E1013] font-bold uppercase hover:bg-[#D4982B]"
              >
                Initialize Container
              </button>
            </form>

            {challengeId && (
              <div className="pt-4 border-t border-[#2D333D] space-y-3 font-mono text-xs">
                <div className="text-[#5FA57F] font-bold">CONTAINER INITIALIZED: {challengeId}</div>

                <form onSubmit={handleUploadFile} className="space-y-2">
                  <label className="block text-[#7F8896] uppercase text-[10px]">
                    Upload Source Module (512 KiB Max)
                  </label>
                  <input
                    type="file"
                    required
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    className="text-xs text-[#EAECE8]"
                  />
                  <button
                    type="submit"
                    disabled={loading || !selectedFile}
                    className="px-3 py-1 bg-[#20242B] border border-[#3D4654] text-[#EAECE8] uppercase text-[10px] font-bold hover:bg-[#2A2F38]"
                  >
                    Commit File
                  </button>
                </form>

                {uploadStatus && <div className="text-[#5FA57F]">{uploadStatus}</div>}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleFreeze}
                    disabled={loading}
                    className="px-4 py-1.5 border border-[#E5A83B] text-[#E5A83B] font-bold uppercase hover:bg-[#E5A83B]/10"
                  >
                    Freeze Container (Lock Ground Truth)
                  </button>
                </div>

                {freezeHash && (
                  <div className="text-[#5FA57F] font-bold text-[11px]">
                    HASH: {freezeHash.substring(0, 16)}...
                  </div>
                )}
              </div>
            )}
          </InstrumentRack>

          {/* Test Results Entry */}
          <InstrumentRack
            channel="TESTS-01"
            title="Commit Offline Test Suite Results"
            telemetryTag="TEST HARNESS"
          >
            <form onSubmit={handleRecordTests} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[#7F8896] uppercase text-[10px] mb-1">Submission Target ID</label>
                <input
                  type="text"
                  required
                  value={subId}
                  onChange={(e) => setSubId(e.target.value)}
                  placeholder="sub-..."
                  className="w-full bg-[#101216] border border-[#2D333D] px-2.5 py-1.5 text-xs text-[#EAECE8]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#7F8896] uppercase text-[10px] mb-1">Passed Tests</label>
                  <input
                    type="number"
                    min={0}
                    value={testsPassed}
                    onChange={(e) => setTestsPassed(parseInt(e.target.value))}
                    className="w-full bg-[#101216] border border-[#2D333D] px-2.5 py-1 text-xs text-[#EAECE8]"
                  />
                </div>
                <div>
                  <label className="block text-[#7F8896] uppercase text-[10px] mb-1">Total Tests</label>
                  <input
                    type="number"
                    min={1}
                    value={testsTotal}
                    onChange={(e) => setTestsTotal(parseInt(e.target.value))}
                    className="w-full bg-[#101216] border border-[#2D333D] px-2.5 py-1 text-xs text-[#EAECE8]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-[#437A55] text-white font-bold uppercase hover:bg-[#366345]"
              >
                Commit Test Results
              </button>
            </form>

            {testResultStatus && (
              <div className="pt-2 font-mono text-xs text-[#5FA57F] font-bold">
                {testResultStatus}
              </div>
            )}
          </InstrumentRack>
        </div>
      )}
    </div>
  );
};
