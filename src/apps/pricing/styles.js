export const CURRENCIES = ['EUR','USD','GBP','AUD','JPY','AED','SAR','QAR'];
export const SOURCES    = ['Portal','File','Website','Invoice','Estimate'];
export const PRICE_USED_OPTIONS = [
  { value:'primary_ex_vat',    label:'Primary w/o VAT',   needs:'msrp_primary_ex_vat' },
  { value:'primary_inc_vat',   label:'Primary w/ VAT',    needs:'msrp_primary_inc_vat' },
  { value:'secondary_ex_vat',  label:'Secondary w/o VAT', needs:'msrp_secondary_ex_vat' },
  { value:'secondary_inc_vat', label:'Secondary w/ VAT',  needs:'msrp_secondary_inc_vat' },
  { value:'cost_based',        label:'Cost + margin',     needs:'exw_cost' },
];

// Design tokens — blue-tinted charcoal, mirrors :root vars in styles/global.css
export const t = {
  bg0:'#0a0c10', bg1:'#0d1015', bg2:'#12151c', bg3:'#191d26', bg4:'#222734',
  b1:'rgba(255,255,255,0.06)', b2:'rgba(255,255,255,0.10)', b3:'rgba(255,255,255,0.18)',
  t1:'#eef1f6', t2:'#b6bdc9', t3:'#7d8694', t4:'#545c68',
  blue:'#4d9fff', green:'#3ecf8e', amber:'#f5a623', red:'#f26464',
};

export const inp = (filled, err) => ({
  width:'100%', background:filled?t.bg3:t.bg2,
  border:`1px solid ${err?'rgba(242,100,100,0.6)':filled?t.b3:t.b2}`,
  borderRadius:8, padding:'10px 14px', fontSize:14,
  color:filled?t.t1:t.t3, fontFamily:'var(--font-sans)',
  outline:'none', transition:'all 0.15s', boxSizing:'border-box',
});
export const sel  = (filled, err) => ({ ...inp(filled,err), cursor:'pointer', appearance:'none', WebkitAppearance:'none', paddingRight:36 });
export const btnW = { padding:'10px 20px', background:t.t1, color:t.bg0, borderRadius:8, fontSize:14, fontWeight:500, cursor:'pointer', border:'none', fontFamily:'var(--font-sans)', whiteSpace:'nowrap' };
export const btnG = { padding:'10px 20px', background:'transparent', color:t.t2, borderRadius:8, fontSize:14, cursor:'pointer', border:`1px solid ${t.b2}`, fontFamily:'var(--font-sans)', whiteSpace:'nowrap' };
export const btnSm     = { padding:'6px 12px', fontSize:12, borderRadius:6 };
export const lbl       = { fontSize:11, color:t.t2, textTransform:'uppercase', letterSpacing:'0.07em', fontFamily:'var(--font-mono)', marginBottom:6, display:'block', fontWeight:500 };
export const sub       = { fontSize:11, color:t.t4, marginTop:5, fontFamily:'var(--font-mono)', lineHeight:1.5 };
export const fg        = { display:'flex', flexDirection:'column' };
export const groupBox  = (err) => ({ background:t.bg2, border:`1px solid ${err?'rgba(242,100,100,0.35)':t.b1}`, borderRadius:12, padding:'20px 24px' });
export const groupHead = { fontSize:11, color:t.t2, textTransform:'uppercase', letterSpacing:'0.1em', fontFamily:'var(--font-mono)', fontWeight:600, marginBottom:20 };
export const segDiv    = { fontSize:11, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.12em', fontFamily:'var(--font-mono)', textAlign:'center', padding:'12px 0', margin:'8px 0', borderTop:`1px solid ${t.b2}`, borderBottom:`1px solid ${t.b2}`, background:'rgba(255,255,255,0.04)', borderRadius:6 };
