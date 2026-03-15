/* ZAS Safeguard — Shared JS v2.0
   DROP INTO: firebase-backend/public/assets/zas-shared.js
*/
(function(){
'use strict';
const rm=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
const nav=document.querySelector('.nav');
if(nav){
  let s=false;
  window.addEventListener('scroll',()=>{
    const ns=window.scrollY>20;
    if(ns!==s){s=ns;nav.classList.toggle('scrolled',ns);}
  },{passive:true});
}
window.zasOpenMenu=function(){
  const m=document.getElementById('mobileMenu');
  if(m){m.style.display='flex';requestAnimationFrame(()=>m.classList.add('open'));}
};
window.zasCloseMenu=function(){
  const m=document.getElementById('mobileMenu');
  if(m){m.classList.remove('open');setTimeout(()=>{if(!m.classList.contains('open'))m.style.display='none';},300);}
};
if(!rm){
  const obs=new IntersectionObserver(entries=>{
    entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target);}});
  },{threshold:0.1});
  document.querySelectorAll('.animate').forEach(el=>obs.observe(el));
}else{
  document.querySelectorAll('.animate').forEach(el=>el.classList.add('visible'));
}
})();

// Logo — set inline base64 so it always loads regardless of file path
(function(){
  const LOGO='data:image/png;base64,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';
  document.querySelectorAll('.nav-logo img, footer .nav-logo img').forEach(function(img){
    img.src=LOGO;
    img.onerror=null; // clear any onerror
  });
})();
