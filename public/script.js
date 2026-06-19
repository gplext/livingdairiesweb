// Navbar scroll effect
window.addEventListener('scroll', () => {
  const navbar = document.getElementById('navbar');
  if (navbar) {
    if (window.scrollY > 40) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }
});

// Mobile menu toggle
function toggleMenu() {
  const links = document.querySelector('.nav-links');
  if (links) links.classList.toggle('open');
}

// Animate elements on scroll
const observerOptions = {
  threshold: 0.12,
  rootMargin: '0px 0px -40px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

document.addEventListener('DOMContentLoaded', () => {
  const animTargets = document.querySelectorAll(
    '.stat-card, .ps-card, .board-card-sm, .gallery-item, .as-card, .tl-item, .cis-card'
  );

  animTargets.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = `opacity 0.6s ease ${i * 0.05}s, transform 0.6s ease ${i * 0.05}s`;
    observer.observe(el);
  });

  // Newsletter subscription
  document.querySelectorAll('.nl-form button').forEach(btn => {
    btn.addEventListener('click', function () {
      const input = this.previousElementSibling;
      if (input && input.value && input.value.includes('@')) {
        this.textContent = '✓ Subscribed!';
        this.style.background = '#40916c';
        this.style.color = '#fff';
        input.value = '';
        setTimeout(() => {
          this.textContent = 'Subscribe';
          this.style.background = '';
          this.style.color = '';
        }, 3000);
      } else {
        input.style.borderColor = 'rgba(255,100,100,0.5)';
        input.placeholder = 'Please enter a valid email';
        setTimeout(() => {
          input.style.borderColor = '';
          input.placeholder = 'Your email address';
        }, 2500);
      }
    });
  });
});
