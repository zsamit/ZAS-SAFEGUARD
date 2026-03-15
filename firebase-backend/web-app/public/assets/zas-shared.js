(function(){
'use strict';
// Nav scroll frost
const nav = document.querySelector('.nav');
let scrolledClass = false;
window.addEventListener('scroll', () => {
  const s = window.scrollY > 80;
  if(s !== scrolledClass){ scrolledClass = s; nav.classList.toggle('scrolled', s); }
}, {passive:true});

// IntersectionObserver for scroll animations
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => { if(e.isIntersecting){ e.target.classList.add('visible'); observer.unobserve(e.target); }});
}, {threshold:0.15});
document.querySelectorAll('.animate').forEach(el => observer.observe(el));

// Stagger indices
document.querySelectorAll('[data-stagger]').forEach(el => {
  el.style.transitionDelay = (parseInt(el.dataset.stagger) * 80) + 'ms';
});
})();