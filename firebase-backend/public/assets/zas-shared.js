/* ZAS Safeguard — Shared JS v1.0
   DROP INTO: firebase-backend/public/assets/zas-shared.js
*/
(function(){
'use strict';
const rm=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
/* Nav frost */
const nav=document.querySelector('.nav');
if(nav){let s=false;window.addEventListener('scroll',()=>{const ns=window.scrollY>80;if(ns!==s){s=ns;nav.classList.toggle('scrolled',ns);}},{passive:true});}
/* Mobile menu */
window.zasOpenMenu=function(){const m=document.getElementById('mobileMenu');if(m){m.style.display='flex';requestAnimationFrame(()=>m.classList.add('open'));}}
window.zasCloseMenu=function(){const m=document.getElementById('mobileMenu');if(m){m.classList.remove('open');setTimeout(()=>{if(!m.classList.contains('open'))m.style.display='none';},300);}}
/* IntersectionObserver entrance */
if(!rm){const obs=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target);}});},{threshold:0.15});document.querySelectorAll('.animate').forEach(el=>obs.observe(el));}
else{document.querySelectorAll('.animate').forEach(el=>el.classList.add('visible'));}
})();
