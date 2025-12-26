import React from 'react';

// Versão otimizada - CSS puro, sem framer-motion, menos elementos
const BackgroundBubbles = () => {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: -1 }}>
      {/* Apenas 2 gradientes estáticos - muito mais leve */}
      <div 
        className="absolute rounded-full bg-green-500/5"
        style={{
          width: 300,
          height: 300,
          left: '10%',
          top: '20%',
          filter: 'blur(60px)',
        }}
      />
      <div 
        className="absolute rounded-full bg-emerald-500/5"
        style={{
          width: 400,
          height: 400,
          right: '10%',
          bottom: '20%',
          filter: 'blur(80px)',
        }}
      />
    </div>
  );
};

export default BackgroundBubbles;
