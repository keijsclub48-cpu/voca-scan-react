/* global p5*/
import React, { useEffect, useRef, useState, useCallback } from 'react';
// import p5 from 'p5';

// --- 設定値 ---
const CONSTANTS = {
  VOL_THRESHOLD: 0.015,   // ノイズゲート閾値
  TUNE_TOLERANCE: 15,     // ジャスト判定（セント）
  DAMPING_FACTOR: 0.08,   // 針の滑らかさ
  MODEL_URL: 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models/models/pitch-detection/crepe/'
};

// ----------------------------------------------------------------
// 1. p5.js Sketch Definition (コンポーネント外部で定義)
// ----------------------------------------------------------------

/**
 * p5の描画ロジックを定義します。
 * 引数はリンター警告を避けるためアンダースコア(_)を使用。
 */
const createSketch = (_canvasRef, _stateRef) => (p) => { 
    
    // 目盛り描画ヘルパー
    const drawTicks = (p, radius) => {
        p.fill(150); p.stroke(150); p.strokeWeight(2); p.textSize(radius * 0.12); p.textStyle(p.NORMAL);
        [-50, 0, 50].forEach(tickVal => {
            p.push(); p.rotate(tickVal);
            p.line(0, -radius * 0.88, 0, -radius * 0.95);
            p.translate(0, -radius * 0.75); p.rotate(-tickVal);
            p.text(tickVal > 0 ? `+${tickVal}` : `${tickVal}`, 0, 0); p.pop();
        });
        p.strokeWeight(1);
        for (let i = -40; i <= 40; i += 10) {
            if (i === 0) continue; 
            p.push(); p.rotate(i); p.line(0, -radius * 0.88, 0, -radius * 0.92); p.pop();
        }
    };

    // メーター描画ロジック本体
    const drawMeter = (p, s) => {
        const w = p.width; const cx = w / 2;
        const outerRadius = w * 0.48; const innerRadius = w * 0.42;

        const colorNormal = p.color(0, 210, 255);
        const colorMatch = p.color(0, 255, 157);
        
        const isMatch = (s.currentFreq > 0 && Math.abs(s.smoothedCentsOff) < CONSTANTS.TUNE_TOLERANCE);
        const activeColor = isMatch ? colorMatch : colorNormal;

        // 1. 外枠 (リング)
        p.noFill(); p.stroke(activeColor); p.strokeWeight(8); p.circle(cx, cx, outerRadius * 2);
        // 2. 内円
        p.fill(255); p.noStroke(); p.circle(cx, cx, innerRadius * 2);

        p.push(); p.translate(cx, cx);
        drawTicks(p, innerRadius);

        // 3. 針
        let needleAngle = p.constrain(s.smoothedCentsOff, -50, 50);

        p.push(); p.rotate(needleAngle);
        p.stroke(activeColor); p.strokeWeight(6); p.strokeCap(p.ROUND);
        p.line(0, -20, 0, -innerRadius * 0.85);
        p.fill(activeColor); p.noStroke(); p.circle(0, 0, 20);
        p.pop();
        p.pop();

        // 4. テキスト情報
        p.fill(0); p.textStyle(p.BOLD); p.textSize(innerRadius * 0.35); 
        p.text(s.currentNoteName, cx, cx + innerRadius * 0.1);

        p.textStyle(p.NORMAL); p.textSize(innerRadius * 0.12);
        let freqText = (!s.isTuning) ? "停止中" : (!s.modelLoaded) ? "準備中..." : (s.currentFreq > 0) ? `${s.currentFreq.toFixed(0)} Hz` : "";

        p.fill(isMatch ? p.color(0, 200, 100) : 100);
        p.text(freqText, cx, cx + innerRadius * 0.3);
    };

    p.setup = () => {
        const w = Math.min(_canvasRef.current.clientWidth, 340);
        p.createCanvas(w, w);
        p.textAlign(p.CENTER, p.CENTER);
        p.angleMode(p.DEGREES);
        p.frameRate(30);
    };

    p.draw = () => {
        p.clear();
        const s = _stateRef.current; // _stateRef の中身を使用
        
        const targetCents = s.isTuning ? s.centsOff : 0;
        s.smoothedCentsOff = p.lerp(s.smoothedCentsOff, targetCents, CONSTANTS.DAMPING_FACTOR);
        
        drawMeter(p, s);
    };

    p.windowResized = () => {
        const w = Math.min(_canvasRef.current.clientWidth, 340);
        p.resizeCanvas(w, w);
    };
};

// ----------------------------------------------------------------
// 2. メインコンポーネント
// ----------------------------------------------------------------

const VocaScanTuner = () => {
  // --- Refs ---
  const canvasRef = useRef(null);
  const p5Instance = useRef(null);
  const mic = useRef(null);
  const pitch = useRef(null);
  const detectPitchLoopRef = useRef(null); // 再帰呼び出し用の参照
  
  // アニメーション用状態
  const stateRef = useRef({
    isTuning: false, modelLoaded: false,
    currentFreq: 0, centsOff: 0, smoothedCentsOff: 0,
    currentNoteName: "--",
  });

  // --- State (UI表示用) ---
  const [stats, setStats] = useState({
    lowestMidi: Infinity, highestMidi: -Infinity,
    lowestFreq: 0, highestFreq: 0, rangeSummary: "--"
  });
  const [isReady, setIsReady] = useState(false);

  // ----------------------------------------------------------------
  // 3. 内部ヘルパー関数の定義 (メモ化)
  // ----------------------------------------------------------------
  
  const getNoteName = useCallback((midiNum) => {
    const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return notes[midiNum % 12] + (Math.floor(midiNum / 12) - 1);
  }, []);

  const resetInstantValues = useCallback(() => {
    const s = stateRef.current;
    s.currentFreq = 0;
    s.centsOff = 0;
    s.currentNoteName = s.isTuning ? "--" : (s.modelLoaded ? "停止中" : "--");
  }, []);

  const updateStats = useCallback((midi, freq) => {
    setStats(prev => {
      let next = { ...prev };
      let updated = false;

      if (midi < next.lowestMidi) { next.lowestMidi = midi; next.lowestFreq = freq; updated = true; }
      if (midi > next.highestMidi) { next.highestMidi = midi; next.highestFreq = freq; updated = true; }

      if (updated) {
          if (next.lowestMidi !== Infinity && next.highestMidi !== -Infinity) {
              let diff = next.highestMidi - next.lowestMidi;
              let octaves = Math.floor(diff / 12);
              let semitones = diff % 12;
              let str = "";
              if (octaves > 0) str += `${octaves}oct`;
              if (semitones > 0) str += ` ${semitones}semi`;
              if (diff === 0) str = "範囲なし";
              next.rangeSummary = str;
          }
          return next;
      }
      return prev;
    });
  }, []);

  // ----------------------------------------------------------------
  // 4. 音程検出ループ (Refを使用)
  // ----------------------------------------------------------------
  
  const detectPitchLoop = useCallback(() => {
    const s = stateRef.current;
    if (!s.isTuning || !pitch.current) return;

    pitch.current.getPitch((err, frequency) => {
      const vol = mic.current ? mic.current.getLevel() : 0;

      if (frequency && frequency > 50 && frequency < 2000 && vol > CONSTANTS.VOL_THRESHOLD) {
        s.currentFreq = frequency;
        
        const midiNumFloat = 12 * (Math.log(frequency / 440) / Math.log(2)) + 69;
        const midiNote = Math.round(midiNumFloat);
        const targetFreq = 440 * Math.pow(2, (midiNote - 69) / 12);
        
        s.centsOff = 1200 * Math.log2(frequency / targetFreq);
        s.currentNoteName = getNoteName(midiNote);
        
        updateStats(midiNote, frequency);
      } else {
        resetInstantValues();
      }

      // Ref を介して関数を呼び出す
      if (s.isTuning && detectPitchLoopRef.current) setTimeout(detectPitchLoopRef.current, 50); 
    });
  }, [resetInstantValues, updateStats, getNoteName]); 

  // ----------------------------------------------------------------
  // 5. detectPitchLoopRef の更新
  // ----------------------------------------------------------------
  
  useEffect(() => {
    detectPitchLoopRef.current = detectPitchLoop;
  }, [detectPitchLoop]);
  
  // ----------------------------------------------------------------
  // 6. 計測の開始/停止
  // ----------------------------------------------------------------

  const toggleTuning = useCallback(async () => {
    const s = stateRef.current;

    if (!s.isTuning) {
      // START
      try {
        if (!mic.current) {
          await p5.prototype.userStartAudio();
          mic.current = new p5.AudioIn();
          
          mic.current.start(async () => {
            if (window.ml5) {
               const ac = p5.prototype.getAudioContext();
               pitch.current = window.ml5.pitchDetection(
                 CONSTANTS.MODEL_URL, ac, mic.current.stream,
                 () => {
                   s.modelLoaded = true;
                   if (s.isTuning) detectPitchLoop(); // 初回起動は直接呼び出し
                 }
               );
            }
          });
        }
        
        s.isTuning = true;
        setIsReady(true);
        if (s.modelLoaded) detectPitchLoop(); // 初回起動は直接呼び出し

      } catch (e) {
        console.error("Audio init error:", e);
        alert("マイクの使用を許可してください");
      }
    } else {
      // STOP
      s.isTuning = false;
      setIsReady(false);
      resetInstantValues();
    }
  }, [detectPitchLoop, resetInstantValues]);

  const resetAll = () => {
    resetInstantValues();
    setStats({
      lowestMidi: Infinity, highestMidi: -Infinity,
      lowestFreq: 0, highestFreq: 0, rangeSummary: "--"
    });
    if (stateRef.current.isTuning) toggleTuning();
  };

  // ----------------------------------------------------------------
  // 7. p5初期化 (useEffect)
  // ----------------------------------------------------------------
  
  useEffect(() => {
    if (canvasRef.current && !p5Instance.current) {
        // createSketch に Refs を渡す
        p5Instance.current = new p5(createSketch(canvasRef, stateRef), canvasRef.current);
    }
    
    return () => {
        if (p5Instance.current) {
            p5Instance.current.remove();
            p5Instance.current = null;
        }
    };
  }, []);

  // --- Render ---
  return (
    <div style={styles.container}>
      <h1 style={styles.header}>Voca-Scan Pro (React)</h1>

      {/* p5 Canvas Container */}
      <div ref={canvasRef} style={styles.canvasWrapper} />

      {/* Stats Area */}
      <div style={styles.statsContainer}>
        <div style={styles.statRow}>
          <span style={styles.statLabel}>Low:</span>
          <span style={styles.statValue}>
            {stats.lowestMidi === Infinity ? "--" : `${getNoteName(stats.lowestMidi)} (${stats.lowestFreq.toFixed(0)}Hz)`}
          </span>
        </div>
        <div style={styles.statRow}>
          <span style={styles.statLabel}>High:</span>
          <span style={styles.statValue}>
            {stats.highestMidi === -Infinity ? "--" : `${getNoteName(stats.highestMidi)} (${stats.highestFreq.toFixed(0)}Hz)`}
          </span>
        </div>
        <div style={styles.rangeSummary}>{stats.rangeSummary}</div>
      </div>

      {/* Buttons */}
      <div style={styles.buttonContainer}>
        <button 
          onClick={toggleTuning} 
          style={{...styles.btn, ...styles.btnStart, backgroundColor: isReady ? '#ff4d4d' : '#00d2ff', color: isReady ? '#fff' : '#080c18'}}
        >
          {isReady ? "計測停止" : "計測開始"}
        </button>
        <button onClick={resetAll} style={{...styles.btn, ...styles.btnReset}}>
          リセット
        </button>
      </div>
    </div>
  );
};

// --- CSS in JS ---
const styles = {
  container: { display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: '#080c18', color: '#fff', minHeight: '100vh', padding: '20px', fontFamily: 'Roboto, sans-serif' },
  header: { color: '#00d2ff', marginBottom: '20px', fontSize: '24px' },
  canvasWrapper: { display: 'flex', justifyContent: 'center', marginBottom: '30px', width: '100%', maxWidth: '340px' },
  statsContainer: { width: '100%', maxWidth: '340px', marginBottom: '30px' },
  statRow: { display: 'flex', justifyContent: 'space-between', marginBottom: '10px', borderBottom: '1px solid #1f293a', paddingBottom: '5px' },
  statLabel: { color: '#a0a0a0' },
  statValue: { fontWeight: 'bold' },
  rangeSummary: { textAlign: 'center', fontSize: '18px', fontWeight: 'bold', marginTop: '15px', color: '#00d2ff' },
  buttonContainer: { display: 'flex', gap: '15px', width: '100%', maxWidth: '340px' },
  btn: { flex: 1, padding: '15px', border: 'none', borderRadius: '12px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer' },
  btnStart: { transition: 'background-color 0.2s' },
  btnReset: { backgroundColor: '#131a2c', color: '#fff', border: '2px solid #2a3449' }
};

export default VocaScanTuner;