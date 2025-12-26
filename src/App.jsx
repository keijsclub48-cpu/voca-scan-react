// App.jsx の例

import React from 'react';
import VocaScanTuner from './VocaScanTuner.jsx'; // 👈 VocaScanTuner をインポート

function App() {
  return (
    <div className="App">
      <header>
        <h1>React Tuner Application</h1>
      </header>
      
      {/* 👈 ここで VocaScanTuner をコンポーネントとして使用 */}
      <VocaScanTuner /> 
      
    </div>
  );
}

export default App;