// Grade virtualizada em canvas: régua no topo, rótulos à esquerda, células step × linha.
// Um dedo/mouse edita; dois dedos (ou roda do mouse / trackpad) rolam.

const TAP_SLOP = 6; // px
const EDIT_DELAY = 90; // ms de espera por um segundo dedo antes de editar

export class GridCanvas {
  /**
   * opts: { headerW, rulerH, rowH, stepW, rows, steps,
   *         draw(g, view), onDown(cell, info), onMove(cell, info), onUp(cell, info),
   *         onRulerTap(step), onHeaderTap(row) }
   */
  constructor(host, opts) {
    this.host = host;
    this.o = opts;
    this.scrollX = 0;
    this.scrollY = 0;
    this.canvas = document.createElement('canvas');
    host.append(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.pointers = new Map();
    this.gesture = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.#bind();
    this.resize();
  }

  destroy() {
    this.ro.disconnect();
    clearTimeout(this.gesture?.timer);
    this.canvas.remove();
  }

  set(patch) {
    Object.assign(this.o, patch);
    this.#clamp();
    this.redraw();
  }

  get contentW() { return this.o.steps * this.o.stepW; }
  get contentH() { return this.o.rows * this.o.rowH; }
  get viewW() { return this.width - this.o.headerW; }
  get viewH() { return this.height - this.o.rulerH; }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.width = Math.max(1, Math.round(r.width));
    this.height = Math.max(1, Math.round(r.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.#clamp();
    this.redraw();
  }

  #clamp() {
    this.scrollX = Math.max(0, Math.min(this.scrollX, this.contentW - this.viewW));
    this.scrollY = Math.max(0, Math.min(this.scrollY, this.contentH - this.viewH));
  }

  scrollTo(x, y) {
    if (x !== null && x !== undefined) this.scrollX = x;
    if (y !== null && y !== undefined) this.scrollY = y;
    this.#clamp();
    this.redraw();
  }

  /** Centraliza a linha `row` verticalmente. */
  centerRow(row) {
    this.scrollTo(null, row * this.o.rowH - this.viewH / 2);
  }

  /** Garante que o step esteja visível (usado pelo cursor de reprodução). */
  ensureStepVisible(step) {
    const x = step * this.o.stepW;
    if (x < this.scrollX || x > this.scrollX + this.viewW - this.o.stepW) {
      this.scrollTo(x - this.o.stepW * 2, null);
    }
  }

  redraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      const { g, dpr } = this;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, this.width, this.height);
      const { headerW, rulerH, rowH, stepW } = this.o;
      const view = {
        width: this.width, height: this.height, headerW, rulerH, rowH, stepW,
        scrollX: this.scrollX, scrollY: this.scrollY,
        x: (step) => headerW + step * stepW - this.scrollX,
        y: (row) => rulerH + row * rowH - this.scrollY,
        firstStep: Math.max(0, Math.floor(this.scrollX / stepW)),
        lastStep: Math.min(this.o.steps, Math.ceil((this.scrollX + this.viewW) / stepW)),
        firstRow: Math.max(0, Math.floor(this.scrollY / rowH)),
        lastRow: Math.min(this.o.rows, Math.ceil((this.scrollY + this.viewH) / rowH)),
      };
      this.o.draw(g, view);
    });
  }

  /** Coordenadas locais → { step, row, x, y, area } (área: 'grid' | 'ruler' | 'header'). */
  cellAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const { headerW, rulerH, rowH, stepW } = this.o;
    const area = y < rulerH ? 'ruler' : x < headerW ? 'header' : 'grid';
    const fx = (x - headerW + this.scrollX) / stepW;
    const step = Math.max(0, Math.min(this.o.steps - 1, Math.floor(fx)));
    const row = Math.max(0, Math.min(this.o.rows - 1, Math.floor((y - rulerH + this.scrollY) / rowH)));
    return { step, row, x, y, area, fracStep: fx };
  }

  #bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.#down(e));
    c.addEventListener('pointermove', (e) => this.#move(e));
    c.addEventListener('pointerup', (e) => this.#up(e));
    c.addEventListener('pointercancel', (e) => this.#up(e, true));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      this.scrollTo(this.scrollX + dx, this.scrollY + dy);
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  #mid() {
    const ps = [...this.pointers.values()];
    return { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
  }

  #down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      // Segundo dedo: vira rolagem. Se a edição ainda não começou, cancela.
      if (this.gesture?.kind === 'pending') clearTimeout(this.gesture.timer);
      else if (this.gesture?.kind === 'edit') this.o.onUp?.(this.gesture.last, { cancelled: true, moved: true });
      this.gesture = { kind: 'pan', last: this.#mid() };
      return;
    }
    if (this.pointers.size > 2) return;

    const cell = this.cellAt(e.clientX, e.clientY);
    if (cell.area !== 'grid') {
      this.gesture = { kind: cell.area, start: { x: e.clientX, y: e.clientY }, cell };
      return;
    }
    const startEdit = () => {
      if (this.gesture?.kind !== 'pending') return;
      this.gesture = { kind: 'edit', start: this.gesture.start, last: cell, moved: false };
      this.o.onDown?.(cell, { pointerType: e.pointerType });
    };
    this.gesture = { kind: 'pending', start: { x: e.clientX, y: e.clientY }, cell };
    if (e.pointerType === 'touch') this.gesture.timer = setTimeout(startEdit, EDIT_DELAY);
    else startEdit();
    this.gesture.startEdit = startEdit;
  }

  #move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const gst = this.gesture;
    if (!gst) return;
    if (gst.kind === 'pan' && this.pointers.size >= 2) {
      const m = this.#mid();
      this.scrollTo(this.scrollX - (m.x - gst.last.x), this.scrollY - (m.y - gst.last.y));
      gst.last = m;
      return;
    }
    const far = Math.hypot(e.clientX - gst.start.x, e.clientY - gst.start.y) > TAP_SLOP;
    if (gst.kind === 'pending' && far) {
      clearTimeout(gst.timer);
      gst.startEdit();
    }
    const g2 = this.gesture;
    if (g2?.kind === 'edit') {
      const cell = this.cellAt(e.clientX, e.clientY);
      if (far) g2.moved = true;
      if (cell.step !== g2.last.step || cell.row !== g2.last.row) {
        g2.last = cell;
        this.o.onMove?.(cell, { moved: g2.moved });
      }
    }
  }

  #up(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const gst = this.gesture;
    if (!gst) return;
    if (gst.kind === 'pan') {
      if (this.pointers.size === 0) this.gesture = null;
      return;
    }
    this.gesture = null;
    if (cancelled) return;
    const far = Math.hypot(e.clientX - gst.start.x, e.clientY - gst.start.y) > TAP_SLOP;
    if (gst.kind === 'pending') {
      clearTimeout(gst.timer);
      gst.kind = 'pending';
      this.gesture = gst;
      gst.startEdit();
      this.gesture = null;
      this.o.onUp?.(gst.cell, { moved: false });
    } else if (gst.kind === 'edit') {
      this.o.onUp?.(gst.last, { moved: gst.moved });
    } else if (gst.kind === 'ruler' && !far) {
      this.o.onRulerTap?.(gst.cell.step);
    } else if (gst.kind === 'header' && !far) {
      this.o.onHeaderTap?.(gst.cell.row);
    }
  }
}
