import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import axios from 'axios';
import './App.css';

const BACKEND = 'http://127.0.0.1:8000';
const FRAME_INTERVAL = 1500;

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 8, padding: '8px 12px' }}>
        <p style={{ color: '#888', fontSize: 11, margin: 0 }}>{payload[0].payload.time}</p>
        <p style={{ color: '#6366f1', fontSize: 14, fontWeight: 600, margin: '2px 0 0' }}>Risk: {payload[0].value}%</p>
        <p style={{ color: '#888', fontSize: 11, margin: '2px 0 0' }}>People: {payload[0].payload.people}</p>
      </div>
    );
  }
  return null;
};

export default function App() {
  const [mode, setMode] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
  const [photoURL, setPhotoURL] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [riskScore, setRiskScore] = useState(0);
  const [riskLevel, setRiskLevel] = useState('safe');
  const [personCount, setPersonCount] = useState(0);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [frameCount, setFrameCount] = useState(0);
  const [detectionMethod, setDetectionMethod] = useState('');
  const [peakRisk, setPeakRisk] = useState(0);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [photoResult, setPhotoResult] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [facingMode, setFacingMode] = useState('user');
  const [confidence, setConfidence] = useState(25);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const photoCanvasRef = useRef(null);
  const intervalRef = useRef(null);

  // ─── RESET ───────────────────────────────────────────────
  const resetAll = () => {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setMode(null);
    setVideoURL(null);
    setPhotoURL(null);
    setHistory([]);
    setAlerts([]);
    setRiskScore(0);
    setPersonCount(0);
    setFrameCount(0);
    setPeakRisk(0);
    setTotalAlerts(0);
    setPhotoResult(null);
    setIsAnalyzing(false);
    setDetectionMethod('');
    setFacingMode('user');
    clearInterval(intervalRef.current);
  };

  // ─── VIDEO UPLOAD ─────────────────────────────────────────
  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    resetAll();
    setMode('video');
    setVideoURL(URL.createObjectURL(file));
  };

  // ─── PHOTO UPLOAD ─────────────────────────────────────────
  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    resetAll();
    setMode('photo');
    setPhotoURL(URL.createObjectURL(file));
    setPhotoLoading(true);
    const formData = new FormData();
    formData.append('file', file, 'photo.jpg');
    try {
      const res = await axios.post(`${BACKEND}/analyze`, formData);
      const { person_count, risk_score, risk_level, detections, detection_method } = res.data;
      const scorePercent = Math.round(risk_score * 100);
      setPhotoResult({ person_count, risk_score, risk_level, detections, detection_method });
      setRiskScore(scorePercent);
      setRiskLevel(risk_level);
      setPersonCount(person_count);
      setDetectionMethod(detection_method);
      setPeakRisk(scorePercent);
      setTimeout(() => drawPhotoOverlay(detections, risk_level), 300);
    } catch (err) {
      console.error('Photo analysis error:', err);
    } finally {
      setPhotoLoading(false);
    }
  };

  const drawPhotoOverlay = (detections, level) => {
    const canvas = photoCanvasRef.current;
    const img = document.getElementById('photo-preview');
    if (!canvas || !img) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const color = level === 'danger' ? '#ef4444' : level === 'warning' ? '#f59e0b' : '#22c55e';
    detections.forEach(d => {
      const x = d.x - d.width / 2;
      const y = d.y - d.height / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, d.width, d.height);
      ctx.fillStyle = color + '22';
      ctx.fillRect(x, y, d.width, d.height);
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 18, 44, 18);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 12px Segoe UI';
      ctx.fillText(`${Math.round(d.confidence * 100)}%`, x + 3, y - 4);
    });
  };

  // ─── CAMERA ───────────────────────────────────────────────
  const startCamera = async (facing = 'user') => {
    try {
      if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing }
      });
      setCameraStream(stream);
      setFacingMode(facing);
      if (!mode) setMode('camera');
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      alert('Camera access denied. Please allow camera permission and try again.');
    }
  };

  const flipCamera = async () => {
    const newFacing = facingMode === 'user' ? 'environment' : 'user';
    const wasAnalyzing = isAnalyzing;
    if (wasAnalyzing) {
      setIsAnalyzing(false);
      clearInterval(intervalRef.current);
    }
    await startCamera(newFacing);
    if (wasAnalyzing) {
      setTimeout(() => {
        setIsAnalyzing(true);
        intervalRef.current = setInterval(captureAndAnalyze, FRAME_INTERVAL);
      }, 500);
    }
  };

  const handleStartCamera = async () => {
    resetAll();
    await startCamera('user');
    setMode('camera');
  };

  useEffect(() => {
    if (mode === 'camera' && cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [mode, cameraStream]);

  // ─── VIDEO / CAMERA ANALYSIS ──────────────────────────────
  const captureAndAnalyze = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (mode !== 'camera' && (video.paused || video.ended)) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');
      try {
        const res = await axios.post(`${BACKEND}/analyze`, formData);
        const { person_count, risk_score, risk_level, detections, detection_method } = res.data;
        const scorePercent = Math.round(risk_score * 100);
        setPersonCount(person_count);
        setRiskScore(scorePercent);
        setRiskLevel(risk_level);
        setDetectionMethod(detection_method);
        setFrameCount(f => f + 1);
        setPeakRisk(p => Math.max(p, scorePercent));
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        setHistory(h => [...h.slice(-30), { time, score: scorePercent, people: person_count }]);
        if (risk_level === 'danger' || risk_level === 'warning') {
          setTotalAlerts(t => t + 1);
          setAlerts(a => [{
            time,
            message: risk_level === 'danger'
              ? `🚨 DANGER — ${person_count} people, risk at ${scorePercent}%`
              : `⚠️ WARNING — ${person_count} people detected`,
            level: risk_level
          }, ...a.slice(0, 14)]);
        }
        drawVideoOverlay(detections, risk_level, video);
      } catch (err) {
        console.error('Analysis error:', err);
      }
    }, 'image/jpeg', 0.85);
  }, [mode]);

  const drawVideoOverlay = (detections, level, video) => {
    const overlay = overlayRef.current;
    if (!overlay || !video) return;
    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const color = level === 'danger' ? '#ef4444' : level === 'warning' ? '#f59e0b' : '#22c55e';
    detections.forEach(d => {
      const x = d.x - d.width / 2;
      const y = d.y - d.height / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, d.width, d.height);
      ctx.fillStyle = color + '22';
      ctx.fillRect(x, y, d.width, d.height);
      ctx.fillStyle = color;
      ctx.font = 'bold 11px Segoe UI';
      ctx.fillText(`${Math.round(d.confidence * 100)}%`, x + 3, y + 13);
    });
  };

  const startAnalysis = () => {
    setIsAnalyzing(true);
    if (mode === 'video') videoRef.current?.play();
    intervalRef.current = setInterval(captureAndAnalyze, FRAME_INTERVAL);
  };

  const stopAnalysis = () => {
    setIsAnalyzing(false);
    if (mode === 'video') videoRef.current?.pause();
    clearInterval(intervalRef.current);
  };

  useEffect(() => () => clearInterval(intervalRef.current), []);

  // ─── CSV DOWNLOAD ─────────────────────────────────────────
  const downloadCSV = () => {
    if (history.length === 0) return;
    const headers = ['Timestamp', 'Risk Score (%)', 'People Detected', 'Risk Level'];
    const rows = history.map(h => [
      h.time, h.score, h.people,
      h.score >= 65 ? 'DANGER' : h.score >= 35 ? 'WARNING' : 'SAFE'
    ]);
    const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crowdsense_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── COLORS ───────────────────────────────────────────────
  const riskColor = riskLevel === 'danger' ? '#ef4444' : riskLevel === 'warning' ? '#f59e0b' : '#22c55e';

  // ─── SHARED: RISK GAUGE ───────────────────────────────────
  const RiskGauge = () => (
    <div className="card">
      <h2>Risk Level</h2>
      <div className="risk-display">
        <div style={{ fontSize: 72, fontWeight: 800, color: riskColor, lineHeight: 1, transition: 'color 0.5s' }}>{riskScore}%</div>
        <div style={{ fontSize: 16, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', padding: '5px 18px', borderRadius: 20, background: riskColor + '22', color: riskColor, transition: 'all 0.5s' }}>
          {riskLevel}
        </div>
        <div style={{ width: '100%', height: 8, background: '#1e1e2e', borderRadius: 4, marginTop: 16, overflow: 'hidden' }}>
          <div style={{ width: `${riskScore}%`, height: '100%', background: riskColor, borderRadius: 4, transition: 'width 0.5s, background 0.5s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: 4 }}>
          <span style={{ fontSize: 10, color: '#22c55e' }}>SAFE</span>
          <span style={{ fontSize: 10, color: '#f59e0b' }}>WARNING</span>
          <span style={{ fontSize: 10, color: '#ef4444' }}>DANGER</span>
        </div>
      </div>
      <div style={{ marginTop: 20, borderTop: '1px solid #1e1e2e', paddingTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#888' }}>Detection Sensitivity</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: riskColor }}>{confidence}%</span>
        </div>
        <input type="range" min="10" max="80" value={confidence}
          onChange={e => setConfidence(Number(e.target.value))}
          style={{ width: '100%', accentColor: riskColor, cursor: 'pointer' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 10, color: '#555' }}>Detect more</span>
          <span style={{ fontSize: 10, color: '#555' }}>Detect less</span>
        </div>
      </div>
    </div>
  );

  // ─── SHARED: RISK CHART ───────────────────────────────────
  const RiskChart = () => (
    <div className="card full-width">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Risk Score History</h2>
        {history.length > 0 && (
          <button onClick={downloadCSV} style={{ padding: '6px 14px', background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: 8, color: '#888', cursor: 'pointer', fontSize: 12 }}>
            ⬇ Download CSV
          </button>
        )}
      </div>
      {history.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#333', fontSize: 14 }}>
          Start analysis to see live risk graph
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={riskColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={riskColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" tick={{ fill: '#444', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fill: '#444', fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={65} stroke="#ef444444" strokeDasharray="4 4" label={{ value: 'DANGER', fill: '#ef4444', fontSize: 10 }} />
            <ReferenceLine y={35} stroke="#f59e0b44" strokeDasharray="4 4" label={{ value: 'WARNING', fill: '#f59e0b', fontSize: 10 }} />
            <Area type="monotone" dataKey="score" stroke={riskColor} strokeWidth={2} fill="url(#riskGrad)" dot={false} name="Risk %" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );

  // ─── SHARED: ALERT LOG ────────────────────────────────────
  const AlertLog = () => (
    <div className="card full-width">
      <h2>Alert Log {alerts.length > 0 && <span style={{ color: '#ef4444', marginLeft: 6 }}>({alerts.length})</span>}</h2>
      {alerts.length === 0 ? (
        <p style={{ color: '#333', fontSize: 14 }}>No alerts triggered — system monitoring</p>
      ) : (
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {alerts.map((a, i) => (
            <div key={i} className="alert-item">
              <div className="alert-dot" style={{ background: a.level === 'danger' ? '#ef4444' : '#f59e0b', marginTop: 4 }} />
              <span className="alert-time">{a.time}</span>
              <span style={{ color: a.level === 'danger' ? '#ef4444' : '#f59e0b' }}>{a.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ─── RENDER ───────────────────────────────────────────────
  return (
    <div className="app">

      {/* Header */}
      <div className="header">
        <div className="dot" style={{ background: isAnalyzing ? '#22c55e' : mode ? '#6366f1' : '#555' }}></div>
        <h1>CrowdSense</h1>
        <span>AI Crowd Risk Analyzer</span>
        {detectionMethod && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#555', background: '#1a1a2e', padding: '3px 10px', borderRadius: 20 }}>
            {detectionMethod.toUpperCase()}
          </span>
        )}
      </div>

      {/* Mode Selector */}
      {!mode && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <label style={{ flex: 1, cursor: 'pointer' }}>
            <input type="file" accept="video/*" onChange={handleVideoUpload} style={{ display: 'none' }} />
            <div className="card" style={{ textAlign: 'center', padding: '32px 20px', border: '2px dashed #2a2a3e', cursor: 'pointer', transition: 'border-color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#6366f1'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#2a2a3e'}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎥</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 6 }}>Upload Video</div>
              <div style={{ fontSize: 13, color: '#555' }}>Analyze crowd in real time</div>
              <div style={{ fontSize: 11, color: '#333', marginTop: 8 }}>MP4, MOV, AVI</div>
            </div>
          </label>

          <label style={{ flex: 1, cursor: 'pointer' }}>
            <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
            <div className="card" style={{ textAlign: 'center', padding: '32px 20px', border: '2px dashed #2a2a3e', cursor: 'pointer', transition: 'border-color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#22c55e'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#2a2a3e'}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🖼️</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 6 }}>Upload Photo</div>
              <div style={{ fontSize: 13, color: '#555' }}>Instant snapshot analysis</div>
              <div style={{ fontSize: 11, color: '#333', marginTop: 8 }}>JPG, PNG, WEBP</div>
            </div>
          </label>

          <div style={{ flex: 1, cursor: 'pointer' }} onClick={handleStartCamera}>
            <div className="card" style={{ textAlign: 'center', padding: '32px 20px', border: '2px dashed #2a2a3e', cursor: 'pointer', transition: 'border-color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#2a2a3e'}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 6 }}>Live Camera</div>
              <div style={{ fontSize: 13, color: '#555' }}>Front + back camera support</div>
              <div style={{ fontSize: 11, color: '#333', marginTop: 8 }}>Requires camera permission</div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      {mode && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'People Detected', value: personCount },
            { label: mode === 'photo' ? 'Mode' : 'Frames Analyzed', value: mode === 'photo' ? 'Photo' : frameCount },
            { label: 'Peak Risk', value: `${peakRisk}%` },
            { label: 'Total Alerts', value: totalAlerts },
          ].map((s, i) => (
            <div key={i} className="card" style={{ flex: 1, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid">

        {/* ── PHOTO MODE ── */}
        {mode === 'photo' && (
          <>
            <div className="card">
              <h2>Photo Analysis</h2>
              {photoLoading && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#6366f1' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                  <div style={{ fontSize: 14 }}>Analyzing crowd...</div>
                </div>
              )}
              {photoURL && !photoLoading && (
                <>
                  <img id="photo-preview" src={photoURL} alt="crowd" style={{ display: 'none' }}
                    onLoad={() => photoResult && drawPhotoOverlay(photoResult.detections, photoResult.risk_level)} />
                  <canvas ref={photoCanvasRef} style={{ width: '100%', borderRadius: 10 }} />
                </>
              )}
              <button onClick={resetAll} style={{ width: '100%', marginTop: 12, padding: '10px', background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: 8, color: '#888', cursor: 'pointer', fontSize: 14 }}>
                ↩ Analyze Another
              </button>
            </div>
            <RiskGauge />
          </>
        )}

        {/* ── VIDEO MODE ── */}
        {mode === 'video' && (
          <>
            <div className="card">
              <h2>Video Feed</h2>
              {isAnalyzing && (
                <div className="analyzing-badge">
                  <div className="dot" style={{ width: 6, height: 6 }}></div>
                  Analyzing · Frame {frameCount}
                </div>
              )}
              <div className="video-container">
                <video ref={videoRef} src={videoURL} muted loop />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <canvas ref={overlayRef} />
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                {!isAnalyzing ? (
                  <button onClick={startAnalysis} style={{ flex: 1, padding: '10px', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                    ▶ Start Analysis
                  </button>
                ) : (
                  <button onClick={stopAnalysis} style={{ flex: 1, padding: '10px', background: '#374151', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                    ⏹ Stop
                  </button>
                )}
                <button onClick={resetAll} style={{ padding: '10px 16px', background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: 8, color: '#888', cursor: 'pointer', fontSize: 14 }}>
                  ↩ Reset
                </button>
              </div>
            </div>
            <RiskGauge />
            <RiskChart />
            <AlertLog />
          </>
        )}

        {/* ── CAMERA MODE ── */}
        {mode === 'camera' && (
          <>
            <div className="card">
              <h2>
                Live Camera
                <span style={{ marginLeft: 8, fontSize: 11, color: '#555', background: '#1e1e2e', padding: '2px 8px', borderRadius: 10 }}>
                  {facingMode === 'user' ? '🤳 Front' : '📸 Back'}
                </span>
              </h2>
              {isAnalyzing && (
                <div className="analyzing-badge">
                  <div className="dot" style={{ width: 6, height: 6 }}></div>
                  Live · Frame {frameCount}
                </div>
              )}
              <div className="video-container">
                <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', borderRadius: 10, transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }} />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <canvas ref={overlayRef} style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }} />
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                {!isAnalyzing ? (
                  <button onClick={startAnalysis} style={{ flex: 1, padding: '10px', background: '#ef4444', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                    🔴 Start Live Analysis
                  </button>
                ) : (
                  <button onClick={stopAnalysis} style={{ flex: 1, padding: '10px', background: '#374151', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                    ⏹ Stop
                  </button>
                )}
                <button onClick={flipCamera} style={{ padding: '10px 14px', background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: 8, color: '#888', cursor: 'pointer', fontSize: 14 }} title="Flip camera">
                  🔄 Flip
                </button>
                <button onClick={resetAll} style={{ padding: '10px 14px', background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: 8, color: '#888', cursor: 'pointer', fontSize: 14 }}>
                  ↩
                </button>
              </div>
            </div>
            <RiskGauge />
            <RiskChart />
            <AlertLog />
          </>
        )}

      </div>
    </div>
  );
}
