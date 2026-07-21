import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { t } from './styles';

export default function Toast({ message, ok, onDone }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => { const timer = setTimeout(() => onDoneRef.current(), 3500); return () => clearTimeout(timer); }, []);
  return (
    <motion.div
      style={{
        position:'fixed', bottom:28, right:28, zIndex:300,
        background: ok ? 'rgba(62,207,142,0.12)' : 'rgba(242,100,100,0.12)',
        border: `1px solid ${ok ? 'rgba(62,207,142,0.4)' : 'rgba(242,100,100,0.4)'}`,
        borderRadius:10, padding:'12px 20px', fontSize:14,
        color: ok ? t.green : t.red, fontFamily:'var(--font-sans)',
        boxShadow:'0 4px 24px rgba(0,0,0,0.5)', maxWidth:360,
        display:'flex', alignItems:'center', gap:10,
      }}
      initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
      exit={{ opacity:0, y:12 }} transition={{ duration:0.2 }}
    >
      <span style={{ fontSize:16 }}>{ok ? '✓' : '✕'}</span>{message}
    </motion.div>
  );
}
