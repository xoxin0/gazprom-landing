/* =========================================================
   Газпром — лендинг: интерактив
   Без зависимостей. Каждый модуль изолирован в своей функции.
   ========================================================= */

(() => {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------
     1. Шапка: компактный режим при прокрутке
     --------------------------------------------------------- */
  function initHeader() {
    const header = document.getElementById('header');
    if (!header) return;

    const update = () => header.classList.toggle('is-scrolled', window.scrollY > 20);

    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  /* ---------------------------------------------------------
     2. Мобильное меню
     --------------------------------------------------------- */
  function initBurger() {
    const burger = document.getElementById('burger');
    const nav = document.getElementById('nav');
    if (!burger || !nav) return;

    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
    };

    burger.addEventListener('click', () => {
      setOpen(burger.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) setOpen(false);
    });
  }

  /* ---------------------------------------------------------
     3. Появление блоков при прокрутке
     --------------------------------------------------------- */
  function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

    items.forEach((el) => observer.observe(el));
  }

  /* ---------------------------------------------------------
     4. Счётчики в блоке «Показатели»
     --------------------------------------------------------- */
  function initCounters() {
    const counters = document.querySelectorAll('[data-count]');
    if (!counters.length) return;

    const render = (el, value) => {
      el.textContent = String(value) + (el.dataset.suffix || '');
    };

    const animate = (el) => {
      const target = Number(el.dataset.count) || 0;
      const duration = 1600;
      const start = performance.now();

      const tick = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic

        render(el, Math.round(target * eased));

        if (progress < 1) requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    };

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      counters.forEach((el) => render(el, Number(el.dataset.count) || 0));
      return;
    }

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animate(entry.target);
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.6 });

    counters.forEach((el) => observer.observe(el));
  }

  /* ---------------------------------------------------------
     5. Подсветка активного пункта меню
     --------------------------------------------------------- */
  function initActiveNav() {
    const links = [...document.querySelectorAll('.nav__link')];
    const sections = links
      .map((link) => document.querySelector(link.getAttribute('href')))
      .filter(Boolean);

    if (!sections.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => {
          link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
        });
      });
    }, { threshold: 0.4, rootMargin: '-88px 0px -40% 0px' });

    sections.forEach((section) => observer.observe(section));
  }

  /* ---------------------------------------------------------
     6. Форма обратной связи → Telegram
     --------------------------------------------------------- */
  function initForm() {
    const form = document.getElementById('feedbackForm');
    const status = document.getElementById('formStatus');
    if (!form || !status) return;

    const ENDPOINT = '/api/lead';

    const RULES = {
      name: {
        test: (v) => v.trim().length >= 2,
        message: 'Укажите имя — минимум 2 символа',
      },
      phone: {
        test: (v) => v.replace(/\D/g, '').length >= 11,
        message: 'Введите телефон в формате +7 (999) 000-00-00',
      },
      email: {
        test: (v) => /^[^\s@]+@[^\s@]+\.[a-zA-Zа-яА-Я]{2,}$/.test(v.trim()),
        message: 'Проверьте адрес электронной почты',
      },
      message: {
        test: (v) => v.trim().length >= 10,
        message: 'Опишите задачу подробнее — минимум 10 символов',
      },
      agree: {
        test: (_, field) => field.checked,
        message: 'Необходимо согласие на обработку данных',
      },
    };

    // У чекбокса сам input скрыт — подсвечиваем обёртку
    const visualOf = (field) =>
      field.type === 'checkbox' ? field.closest('.check') : field;

    const errorFor = (name) => form.querySelector(`[data-error-for="${name}"]`);

    const showError = (field, message) => {
      const box = errorFor(field.name);
      visualOf(field).classList.add('is-invalid');
      field.setAttribute('aria-invalid', 'true');
      if (box) {
        box.textContent = message;
        box.classList.add('is-visible');
      }
    };

    const clearError = (field) => {
      const box = errorFor(field.name);
      visualOf(field).classList.remove('is-invalid');
      field.removeAttribute('aria-invalid');
      if (box) {
        box.textContent = '';
        box.classList.remove('is-visible');
      }
    };

    const validateField = (field) => {
      const rule = RULES[field.name];
      if (!rule) return true;

      if (rule.test(field.value, field)) {
        clearError(field);
        return true;
      }

      showError(field, rule.message);
      return false;
    };

    /* Маска телефона: +7 (999) 000-00-00 */
    const phone = form.elements.phone;
    if (phone) {
      phone.addEventListener('input', () => {
        let digits = phone.value.replace(/\D/g, '');

        if (digits.startsWith('8')) digits = '7' + digits.slice(1);
        if (!digits.startsWith('7')) digits = '7' + digits;
        digits = digits.slice(0, 11);

        const [, a = '', b = '', c = '', d = ''] =
          digits.match(/^7(\d{0,3})(\d{0,3})(\d{0,2})(\d{0,2})$/) || [];

        let out = '+7';
        if (a) out += ` (${a}`;
        if (a.length === 3) out += ')';
        if (b) out += ` ${b}`;
        if (c) out += `-${c}`;
        if (d) out += `-${d}`;

        phone.value = out;
      });
    }

    /* Живая валидация: проверяем при уходе из поля, а после ошибки — на каждый ввод */
    Object.keys(RULES).forEach((name) => {
      const field = form.elements[name];
      if (!field) return;

      const leaveEvent = field.type === 'checkbox' ? 'change' : 'blur';
      field.addEventListener(leaveEvent, () => validateField(field));
      field.addEventListener('input', () => {
        if (visualOf(field).classList.contains('is-invalid')) validateField(field);
      });
    });

    const setStatus = (text, isError = false) => {
      status.textContent = text;
      status.classList.toggle('is-error', isError);
      status.classList.toggle('is-visible', Boolean(text));
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const fields = Object.keys(RULES)
        .map((name) => form.elements[name])
        .filter(Boolean);

      const invalid = fields.filter((field) => !validateField(field));

      if (invalid.length) {
        setStatus('Проверьте отмеченные поля', true);
        invalid[0].focus();
        return;
      }

      const submitBtn = form.querySelector('[type="submit"]');
      const label = submitBtn.querySelector('span');
      const original = label.textContent;

      submitBtn.disabled = true;
      label.textContent = 'Отправляем…';
      setStatus('');

      const payload = {
        name: form.elements.name.value.trim(),
        phone: form.elements.phone.value.trim(),
        email: form.elements.email.value.trim(),
        topic: form.elements.topic.value,
        message: form.elements.message.value.trim(),
        company: form.elements.company ? form.elements.company.value : '', // honeypot
      };

      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.ok) {
          throw new Error(result.error || 'Не удалось отправить заявку');
        }

        form.reset();
        fields.forEach(clearError);
        setStatus(result.message || 'Спасибо! Заявка принята — свяжемся в течение рабочего дня.');
      } catch (error) {
        setStatus(
          `${error.message}. Позвоните нам: 8 800 123-45-67`,
          true
        );
      } finally {
        submitBtn.disabled = false;
        label.textContent = original;
      }
    });
  }

  /* ---------------------------------------------------------
     Запуск
     --------------------------------------------------------- */
  const init = () => {
    initHeader();
    initBurger();
    initReveal();
    initCounters();
    initActiveNav();
    initForm();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
