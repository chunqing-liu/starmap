import { Application, Container, Graphics, Text } from 'pixi.js';
import 'pixi.js/unsafe-eval';
import type { OfficePresence } from '../../../shared/office';
import type { OfficeRuntime } from './vendor/runtime/OfficeRuntime';
import { AgentEntity } from './vendor/scene/entities/AgentEntity';
import type { PropView } from './vendor/scene/views/propViews';
import { OfficeArtwork } from './artwork';
import { officeReturnRoute, officeWalkRoute, sampleOfficeWalk } from './roster-motion';
import type { Point, World } from './vendor/runtime/model';
import { officeRole } from './roles';
import { projectAgents } from './vendor/runtime/adapters/legacy';
import { computeAgentDepthZ } from './vendor/scene/systems/deskDepthSort';
import { CELL_PIXELS, propPixels } from './vendor/scene/gridProjection';
import { OfficeTextures } from './textures';
import { placeOfficeLabel, type LabelRect } from './label-layout';
import { OfficeLeisure, LEISURE_LABELS, officeRouteFromPixel, type InteractionAction, type LeisurePose, type OfficeScreen } from './leisure';
import { OfficeDiscussion } from './discussion';
import { sceneObjectArtwork } from './scene-art';
import type { ActorPresentation } from './bridge';

export class StarmapScene {
  private static applications = 0;
  private app?: Application;
  private textures?: OfficeTextures;
  private element?: HTMLElement;
  private world = new Container();
  private layer = new Container();
  private highlight = new Graphics();
  private entities = new Map<string, AgentEntity>();
  private labels = new Map<string, HTMLElement>();
  private overlay?: HTMLDivElement;
  private breathTimer?: ReturnType<typeof setTimeout>;
  private idleRenders = 0;
  private renders = 0;
  private artwork = new OfficeArtwork();
  private leisure = new OfficeLeisure();
  private leisurePoses = new Map<string, InteractionAction>();
  private behaviors = new Map<string, LeisurePose>();
  private discussion = new OfficeDiscussion();
  private ambientDiscussion = new OfficeDiscussion();
  private responses = new Graphics();
  private screens = new Map<string, OfficeScreen>();
  private doneLabels = new Map<string, Text>();
  private transitions = new Map<string, { started: number; entering: boolean; entity: AgentEntity; route: Point[] }>();
  private previousWorld?: World;
  private room?: Container;
  private displaySize = { width: 0, height: 0 };
  private light = new Graphics();
  private activity = new Map<string, Graphics>();
  private stateUntil = 0;
  private hoverUntil = 0;
  private hovered?: string;
  private focused?: string;
  private emphasis = new Map<string, number>();
  private rosterTransitions = 0;
  private props: PropView[] = [];
  private observer?: ResizeObserver;
  private resize?: () => void;
  private unsubscribe?: () => void;
  private disposed = false;
  private active = false;
  private reduced = false;
  private maintenance?: ReturnType<typeof setTimeout>;
  private maintenanceTime = 0;
  private maintaining = false;
  private selected: string[] = [];
  private presence = new Map<string, OfficePresence>();
  private presenceSignature = '';
  private poseSampledAt = 0;
  constructor(private runtime: OfficeRuntime, private onActor: (id: string) => void, private onAdvance = () => {}) {}

  async mount(element: HTMLElement) {
    const app = new Application();
    await app.init({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight), backgroundColor: 0xf3f6fa, antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio || 1, 2), autoStart: false });
    if (this.disposed) { app.destroy(true, { children: true }); return; }
    this.app = app;
    StarmapScene.applications++;
    this.element = element;
    this.textures = new OfficeTextures(app.renderer);
    element.appendChild(app.canvas);
    this.overlay = document.createElement('div'); this.overlay.className = 'office-labels'; element.appendChild(this.overlay);
    app.canvas.setAttribute('aria-label', '伙伴的程序化工作室，等价信息见人员列表');
    app.ticker.maxFPS = 30;
    this.layer.sortableChildren = true;
    app.stage.addChild(this.world);
    this.populate();
    const resize = () => {
      if (this.disposed || element.clientWidth < 1 || element.clientHeight < 1) return;
      app.renderer.resize(element.clientWidth, element.clientHeight);
      const { width, height } = this.displaySize;
      const scale = Math.min(element.clientWidth / (width * CELL_PIXELS), element.clientHeight / (height * CELL_PIXELS));
      this.world.scale.set(scale);
      this.world.position.set((element.clientWidth - width * CELL_PIXELS * scale) / 2, (element.clientHeight - height * CELL_PIXELS * scale) / 2);
      this.layoutLabels();
      this.render();
      this.diagnostics();
    };
    this.resize = resize;
    this.observer = new ResizeObserver(resize);
    this.observer.observe(element);
    this.unsubscribe = this.runtime.subscribe(() => this.changed());
    this.sync(); resize();
    app.ticker.add(this.onTick);
    this.setActive(this.active);
  }

  private clearTransitions() {
    for (const transition of this.transitions.values()) if (!transition.entering) { transition.entity.removeFromParent(); transition.entity.destroy({ children: true }); }
    this.transitions.clear();
    this.entities.forEach(entity => { entity.scale.y = 1; entity.finishVisualTransition(); });
  }
  private render() { if (this.active && this.app) { this.app.render(); this.renders++; } }
  private drawRoom() {
    this.room?.removeFromParent(); this.room?.destroy({ children: true });
    const floor = this.artwork.room(this.displaySize.width * CELL_PIXELS, this.displaySize.height * CELL_PIXELS, this.entities.size);
    this.room = floor;
    this.world.addChildAt(floor, 0);
    floor.cacheAsTexture({ resolution: Math.min(2, 4096 / Math.max(this.displaySize.width * CELL_PIXELS, this.displaySize.height * CELL_PIXELS)) });
  }
  private animateRoster() {
    const now = performance.now();
    for (const [id, transition] of this.transitions) {
      const sampled = sampleOfficeWalk(transition.route, now - transition.started);
      const entity = transition.entity;
      entity.apply({ state: 'walking', seated: false, viewFacing: sampled.facing, facing: sampled.facing === 'left' ? -1 : 1 });
      entity.setPosition(sampled.x, sampled.y); entity.zIndex = sampled.y;
      entity.alpha = 1;
      entity.updateVisuals('walking', this.app!.ticker.deltaMS / 1000);
      if (sampled.done) {
        if (!transition.entering) { entity.removeFromParent(); entity.destroy({ children: true }); }
        else { this.stateUntil = now + 240; }
        this.transitions.delete(id);
      }
    }
    if (!this.transitions.size && (this.displaySize.width !== this.runtime.readWorld().width || this.displaySize.height !== this.runtime.readWorld().height)) {
      this.displaySize = { width: this.runtime.readWorld().width, height: this.runtime.readWorld().height };
      this.drawRoom(); this.resize?.();
    }
  }
  private populate() {
    const now = performance.now();
    const ongoing = new Map([...this.transitions].map(([id, transition]) => [id, { ...transition, agent: { ...transition.entity.data } }]));
    const previousAgents = [...this.entities.values()].map(entity => ({ ...entity.data }));
    const previousIds = new Set(previousAgents.map(agent => agent.id));
    this.clearTransitions();
    this.world.removeChildren().forEach(child => child.destroy({ children: true }));
    this.room = undefined;
    this.artwork.dispose(); this.textures?.dispose();
    if (this.app) this.textures = new OfficeTextures(this.app.renderer);
    this.layer = new Container(); this.layer.sortableChildren = true;
    this.highlight = new Graphics(); this.light = new Graphics(); this.responses = new Graphics();
    this.entities.clear(); this.labels.clear(); this.activity.clear(); this.doneLabels.clear(); this.emphasis.clear(); this.overlay?.replaceChildren();
    const data = this.runtime.readWorld();
    this.leisure.retain(data.actors.map(actor => actor.id)); this.discussion.retain(data.actors.map(actor => actor.id)); this.leisurePoses.clear(); this.behaviors.clear();
    const retirees = previousAgents.filter(agent => !data.actors.some(actor => actor.id === agent.id));
    const animated = this.active && !this.reduced;
    const exiting = retirees.length > 0 || [...ongoing.values()].some(transition => !transition.entering && !data.actors.some(actor => actor.id === transition.agent.id));
    this.displaySize = { width: animated && exiting ? Math.max(data.width, this.displaySize.width, this.previousWorld?.width || 0) : data.width, height: animated && exiting ? Math.max(data.height, this.displaySize.height, this.previousWorld?.height || 0) : data.height };
    this.world.addChild(this.light, this.highlight, this.layer); this.responses.zIndex = 100000; this.layer.addChild(this.responses);
    const agents = projectAgents(this.runtime, false);
    this.props = data.props.map(prop => {
      const view = prop.templateId === 'office.workstation' ? this.artwork.workstation(prop) : prop.templateId === 'office.whiteboard' ? this.artwork.whiteboard(prop) : sceneObjectArtwork(this.artwork, prop);
      view.update(prop, this.runtime.template(prop.templateId), agents);
      view.roots.forEach(item => { this.layer.addChild(item); item.cacheAsTexture({ resolution: 2 }); });
      if (prop.templateId === 'office.workstation') {
        const actorId = data.actors.find(actor => actor.homeId === prop.id)?.id;
        if (actorId) {
          view.hitTarget.eventMode = 'static'; view.hitTarget.cursor = 'pointer';
          view.hitTarget.on('pointerover', () => this.hover(actorId)).on('pointerout', () => this.hover(undefined));
          view.hitTarget.on('pointertap', event => { event.stopPropagation(); this.focused = actorId; this.hover(actorId); this.onActor(actorId); });
          const effect = new Graphics(); this.activity.set(actorId, effect); this.layer.addChild(effect);
          const done = new Text({ text: 'Done', style: { fontFamily: 'system-ui, sans-serif', fontSize: 13, fontWeight: '600', fill: 0xc6f5e3 } });
          done.anchor.set(.5); done.visible = false; this.doneLabels.set(actorId, done); this.layer.addChild(done);
        }
      }
      return view;
    });
    const makeEntity = (agent: typeof agents[number]) => {
      const variation = [...agent.id].reduce((total, letter) => total + letter.charCodeAt(0), 0);
      return new AgentEntity(agent, false, (state, phase, color, seated, facing) => this.textures!.actor(state, phase, color, seated, facing, variation, this.leisurePoses.get(agent.id)));
    };
    const walk = (id: string, entity: AgentEntity, route: Point[], entering: boolean, started = now) => {
      this.transitions.set(id, { started, entering, entity, route });
      const point = sampleOfficeWalk(route, now - started);
      entity.apply({ state: 'walking', seated: false, viewFacing: point.facing, facing: point.facing === 'left' ? -1 : 1 });
      entity.setPosition(point.x, point.y); entity.zIndex = point.y;
    };
    for (const agent of agents) {
      const entity = makeEntity(agent);
      const previous = previousAgents.find(item => item.id === agent.id);
      if (previous) entity.setPosition(previous.x, previous.y);
      entity.on('pointertap', event => { event.stopPropagation(); this.focused = agent.id; this.hover(agent.id); this.onActor(agent.id); });
      entity.on('pointerover', () => this.hover(agent.id)).on('pointerout', () => this.hover(undefined));
      this.entities.set(agent.id, entity); this.layer.addChild(entity);
      const label = document.createElement('div'); label.className = 'office-actor-label'; label.dataset.officeLabel = agent.id; label.hidden = true; label.setAttribute('role', 'tooltip');
      this.labels.set(agent.id, label); this.overlay?.appendChild(label);
      const transition = ongoing.get(agent.id);
      if (animated && transition) {
        walk(agent.id, entity, transition.entering ? transition.route : officeReturnRoute(transition.route, now - transition.started), true, transition.entering ? transition.started : now);
      } else if (animated && !previousIds.has(agent.id)) {
        const actor = data.actors.find(actor => actor.id === agent.id)!;
        const route = officeWalkRoute(data, this.runtime, actor.homeId!, actor.position, true);
        walk(agent.id, entity, route, true);
        this.rosterTransitions++;
      }
    }
    if (animated && this.previousWorld) for (const agent of retirees) {
      const actor = this.previousWorld.actors.find(actor => actor.id === agent.id)!;
      const entity = makeEntity({ ...agent, state: 'walking', seated: false }); this.layer.addChild(entity);
      const transition = ongoing.get(agent.id);
      const route = transition?.entering ? officeReturnRoute(transition.route, now - transition.started) : officeRouteFromPixel(this.previousWorld, this.runtime, agent, { x: 0, y: this.previousWorld.height - 2 }, actor.homeId!);
      walk(agent.id, entity, route, false); this.rosterTransitions++;
    }
    if (animated) for (const [id, transition] of ongoing) {
      if (transition.entering || data.actors.some(actor => actor.id === id) || retirees.some(agent => agent.id === id)) continue;
      const entity = makeEntity(transition.agent); this.layer.addChild(entity);
      walk(id, entity, transition.route, false, transition.started);
    }
    this.previousWorld = data;
    this.drawRoom(); this.drawSelection(); this.drawActivity();
  }
  refreshRoster() {
    if (this.app) { this.populate(); this.sync(); this.resize?.(); this.changed(); }
  }
  replaceRuntime(runtime: OfficeRuntime) {
    this.unsubscribe?.();
    this.runtime = runtime;
    if (this.app) {
      this.populate();
      this.unsubscribe = runtime.subscribe(() => this.changed());
      this.sync(); this.resize?.();
    }
  }
  setPresence(entries: OfficePresence[]) {
    this.presence = new Map(entries.map(entry => [entry.identity.id, entry]));
    const signature = JSON.stringify(entries.map(entry => [entry.identity.id, entry.expired, entry.disconnected, entry.status === 'offline', entry.expired || entry.disconnected || entry.status === 'offline' ? entry.lastSeen : 0]));
    if (signature !== this.presenceSignature) { this.presenceSignature = signature; this.changed(); }
  }
  setScreens(actors: ActorPresentation[]) {
    const screens = new Map(actors.map(actor => [actor.id, actor.screen || (actor.status === 'idle' ? 'off' : actor.status)] as const));
    if (JSON.stringify([...screens]) === JSON.stringify([...this.screens])) return;
    this.screens = screens;
    this.changed();
  }
  private sync() {
    const world = this.runtime.readWorld();
    const phases = this.runtime.readActivePhases();
    const participants = new Set(phases.flatMap(phase => phase.participants));
    const discussionGroup = [...new Set(phases.filter(phase => phase.capability === 'starmap.handoff' && !['返回工位', '入座'].includes(phase.title)).flatMap(phase => phase.participants))].slice(0, 3);
    const now = performance.now();
    this.poseSampledAt = now;
    this.leisure.retain(world.actors.map(actor => actor.id));
    for (const [index, agent] of projectAgents(this.runtime, false).entries()) {
      const entity = this.entities.get(agent.id);
      const actor = world.actors[index];
      const presence = this.presence.get(agent.id);
      const stale = presence && (presence.expired || presence.disconnected || presence.status === 'offline');
      let activity: InteractionAction | undefined;
      if (entity && !this.transitions.has(agent.id)) {
        const idle = actor.presentation.status === 'idle' && agent.state === 'idle' && !participants.has(agent.id) && !stale;
        const desk = world.props.find(prop => prop.id === actor.homeId)!;
        const home = { x: desk.position.x, y: desk.position.y + 1 };
        const pose = this.discussion.sample(agent.id, stale ? [] : discussionGroup, world, this.runtime, actor.homeId!, home, entity.position, now, this.reduced)
          || this.leisure.sample(agent.id, index, world, this.runtime, actor.homeId!, home, now, idle, this.reduced, false, entity.position, discussionGroup.length, this.screens.get(agent.id) === 'done');
        if (this.discussion.has(agent.id)) this.leisure.forget(agent.id);
        if (pose) this.behaviors.set(agent.id, pose); else this.behaviors.delete(agent.id);
        activity = pose?.activity;
        if (activity) this.leisurePoses.set(agent.id, activity); else this.leisurePoses.delete(agent.id);
        const state = pose ? pose.walking ? 'walking' : activity === 'present' || activity === 'listen' ? 'talking' : 'idle' : agent.state;
        if (entity.data.state !== state) this.stateUntil = now + 240;
        entity.apply({ ...agent, state, ...(pose ? { seated: pose.seated || pose.stage === 'waiting', viewFacing: pose.facing, facing: 1, bubbleText: undefined } : { viewFacing: agent.seated ? index % 2 ? 'left' : 'right' : agent.viewFacing }) });
        entity.setPosition(pose?.x ?? agent.x, pose?.y ?? agent.y);
      }
      if (entity) { entity.tint = stale ? 0x929292 : 0xffffff; entity.alpha = stale ? 0.55 : 1; if (this.reduced) entity.finishVisualTransition(); }
      if (entity) entity.zIndex = computeAgentDepthZ({ ...agent, x: entity.x, y: entity.y });
      const label = this.labels.get(agent.id);
      if (label) { label.textContent = agent.name + ' · ' + (stale ? '过期/离线' : activity ? LEISURE_LABELS[activity] : this.behaviors.get(agent.id)?.stage === 'waiting' ? '等候场景空位' : { idle: '起身准备活动', working: '在工位敲键盘', thinking: '在工位思考', walking: '正在前往场景', talking: '讨论中' }[entity?.data.state || agent.state]); label.dataset.activity = activity || ''; label.dataset.screen = this.screens.get(agent.id) || 'off'; }
    }
    const board = [...this.behaviors].filter(([, pose]) => pose.activity === 'wander').map(([id]) => id);
    this.ambientDiscussion.retain(board);
    if (!discussionGroup.length && board.length) for (const id of board) {
      const entity = this.entities.get(id)!, actor = world.actors.find(actor => actor.id === id)!, desk = world.props.find(prop => prop.id === actor.homeId)!;
      if (board.length < 2 && !this.ambientDiscussion.has(id)) continue;
      const pose = this.ambientDiscussion.sample(id, board, world, this.runtime, actor.homeId!, { x: desk.position.x, y: desk.position.y + 1 }, entity.position, now, this.reduced)!;
      this.behaviors.set(id, pose);
      if (pose.activity) this.leisurePoses.set(id, pose.activity); else this.leisurePoses.delete(id);
      entity.apply({ state: pose.walking ? 'walking' : 'talking', seated: false, viewFacing: pose.facing, bubbleText: undefined }); entity.setPosition(pose.x, pose.y); entity.zIndex = pose.y;
      const label = this.labels.get(id); if (label) label.textContent = entity.data.name + ' · ' + (pose.activity ? LEISURE_LABELS[pose.activity] : '换站位继续讨论');
    }
  }
  private layoutLabels() {
    if (!this.element || !this.app) return;
    const obstacles: LabelRect[] = this.props.flatMap(view => view.roots.map(item => { const bounds = item.getBounds(); return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; }));
    const prioritized = [...this.labels].sort(([first], [second]) => Number(second === this.hovered || second === this.focused) - Number(first === this.hovered || first === this.focused));
    for (const [id, label] of prioritized) {
      const entity = this.entities.get(id); if (!entity) continue;
      label.hidden = id !== this.hovered && id !== this.focused && !this.selected.includes(id);
      if (label.hidden) continue;
      const anchor = this.world.toGlobal(entity.position);
      const rect = placeOfficeLabel(anchor, { width: label.offsetWidth, height: label.offsetHeight }, { width: this.element.clientWidth, height: this.element.clientHeight }, obstacles);
      label.hidden = !rect;
      label.dataset.furniture = JSON.stringify(obstacles.slice(0, this.props.reduce((count, view) => count + view.roots.length, 0)));
      if (rect) { label.style.left = rect.x + 'px'; label.style.top = rect.y + 'px'; obstacles.push(rect); }
    }
  }
  private updateBreathing() {
    const enabled = Boolean(this.app) && this.active && !this.reduced && !this.runtime.hasMotionWork && !this.app?.ticker.started && this.runtime.readActors().some(actor => actor.presentation.status === 'idle');
    if (!enabled && this.breathTimer !== undefined) { clearTimeout(this.breathTimer); this.breathTimer = undefined; }
    if (enabled && this.breathTimer === undefined) this.breathTimer = setTimeout(() => {
      this.breathTimer = undefined;
      if (this.disposed || !this.active || this.reduced) return;
      const opacity = [1, .985, .97, .985][Math.floor(performance.now() / 800) % 4];
      this.entities.forEach((entity, id) => { const presence = this.presence.get(id); if (entity.data.state === 'idle' && !presence?.expired && !presence?.disconnected && presence?.status !== 'offline') { entity.alpha = opacity; entity.scale.y = 1 + (1 - opacity) * .4; } });
      this.sync(); this.entities.forEach(entity => entity.updateVisuals(entity.data.state, .8)); this.drawActivity(); this.drawLight(); this.layoutLabels(); this.render(); this.idleRenders++; this.updateTicker();
    }, 800);
  }
  private changed() {
    if (this.disposed) return;
    this.sync();
    const data = this.runtime.readWorld();
    const agents = projectAgents(this.runtime, false);
    this.props.forEach((view, index) => { view.update(data.props[index], this.runtime.template(data.props[index].templateId), agents); view.roots.forEach(item => item.updateCacheTexture()); });
    this.layoutLabels();
    this.updateTicker();
    if (this.active && !this.reduced) this.animateRoster();
    this.drawActivity(); this.drawLight();
    if (this.active && !this.app?.ticker.started) this.render();
  }
  private diagnostics() {
    if (this.element) this.element.dataset.officeReduced = String(this.reduced);
    if (this.element) this.element.dataset.officePoseSampledAt = String(this.poseSampledAt);
    if (this.element) this.element.dataset.officeDiagnostics = JSON.stringify({ applications: StarmapScene.applications, tickerListeners: this.app?.ticker.count || 0, ticker: Boolean(this.app?.ticker.started), runtimeId: this.runtime.runtimeId, actors: this.entities.size, positionMismatches: projectAgents(this.runtime, false).filter(agent => { const entity = this.entities.get(agent.id); return !entity || !this.transitions.has(agent.id) && !this.leisure.has(agent.id) && !this.discussion.has(agent.id) && (entity.x !== agent.x || entity.y !== agent.y); }).length, textures: this.textures?.size || 0, listeners: this.runtime.listenerCount, sceneSubscriptions: this.unsubscribe ? 1 : 0, resizeObservers: this.observer ? 1 : 0, maintenance: this.maintenance !== undefined, breathing: this.breathTimer !== undefined, idleRenders: this.idleRenders, renders: this.renders, rosterTransitions: this.rosterTransitions, reduced: this.reduced, hovered: this.hovered, effects: this.activity.size, transitions: this.transitions.size, leisureMoving: this.leisure.moving, visualActors: [...this.entities].map(([id, entity]) => ({ id, x: entity.x, y: entity.y, state: entity.data.state, seated: entity.data.seated, facing: entity.data.viewFacing, activity: this.leisurePoses.get(id), stage: this.behaviors.get(id)?.stage, propId: this.behaviors.get(id)?.propId, slot: this.behaviors.get(id)?.slot, screen: this.screens.get(id) || 'off', scaleX: Math.abs(entity.scale.x), scaleY: entity.scale.y })), desks: this.runtime.readWorld().props.filter(prop => prop.templateId === 'office.workstation').length, sceneObjects: this.runtime.readWorld().props.filter(prop => prop.templateId !== 'office.workstation').map(prop => ({ id: prop.id, x: prop.position.x, y: prop.position.y })), room: { width: this.runtime.readWorld().width, height: this.runtime.readWorld().height }, scale: this.world.scale.x });
  }
  private updateTicker() {
    if (this.disposed) return;
    const animated = !this.reduced && this.runtime.readActors().some(actor => actor.presentation.status !== 'idle');
    const enabled = this.active && !this.reduced && (this.runtime.hasMotionWork || animated || this.leisure.active || this.discussion.active || this.transitions.size > 0 || performance.now() < this.stateUntil || performance.now() < this.hoverUntil);
    if (enabled) this.app?.ticker.start();
    else if (this.app?.ticker.started) {
      this.app.ticker.stop(); this.hoverUntil = 0;
      this.entities.forEach(entity => entity.finishVisualTransition());
      this.drawActivity(); this.layoutLabels(); this.render();
    }
    this.updateBreathing(); this.diagnostics();
    if ((!this.active || this.reduced) && this.runtime.hasPendingSettlement && this.maintenance === undefined && !this.maintaining) {
      this.maintenanceTime = performance.now();
      this.maintenance = setTimeout(this.settleHidden, 33);
    }
  }
  private settleHidden = () => {
    const now = performance.now();
    this.maintenance = undefined;
    if (this.active && !this.reduced || this.disposed || !this.runtime.hasPendingSettlement) return;
    this.maintaining = true;
    try { this.runtime.settleCancelled(now - this.maintenanceTime); this.maintenanceTime = now; this.onAdvance(); }
    finally { this.maintaining = false; }
    if ((!this.active || this.reduced) && !this.disposed && this.runtime.hasPendingSettlement) this.maintenance = setTimeout(this.settleHidden, 33);
  };
  private onTick = () => {
    if (!this.active || !this.app) return;
    this.runtime.tick(this.app.ticker.deltaMS);
    this.onAdvance();
    this.sync(); this.animateRoster();
    this.entities.forEach((entity, id) => { if (!this.transitions.has(id)) entity.updateVisuals(entity.data.state, this.app!.ticker.deltaMS / 1000); });
    this.drawActivity(); this.layoutLabels(); this.drawLight();
    this.renders++;
    this.updateTicker();
  };
  setActive(active: boolean) {
    this.active = active;
    this.leisure.setPaused(!active || this.reduced, performance.now()); this.discussion.setPaused(!active || this.reduced, performance.now()); this.ambientDiscussion.setPaused(!active || this.reduced, performance.now());
    if (!active) this.clearTransitions(); else { this.sync(); this.drawActivity(); this.drawLight(); this.render(); }
    if (active && this.maintenance !== undefined) { clearTimeout(this.maintenance); this.maintenance = undefined; }
    this.updateTicker();
  }
  setReduced(reduced: boolean) { this.reduced = reduced; this.leisure.setPaused(reduced || !this.active, performance.now()); this.discussion.setPaused(reduced || !this.active, performance.now()); this.ambientDiscussion.setPaused(reduced || !this.active, performance.now()); if (reduced) this.clearTransitions(); this.sync(); this.changed(); }
  select(ids: string[]) { this.selected = ids; this.drawSelection(); this.drawActivity(); this.layoutLabels(); this.render(); this.diagnostics(); }
  private hover(id?: string) {
    if (id === this.hovered && performance.now() < this.hoverUntil) return;
    this.hovered = id; this.hoverUntil = this.reduced ? 0 : performance.now() + 280;
    this.layoutLabels(); this.drawActivity(); this.render(); this.updateTicker();
  }
  private drawActivity() {
    const now = this.reduced ? 0 : performance.now();
    this.responses.clear();
    for (const [id, pose] of this.behaviors) {
      if (pose.activity === 'brew') {
        this.responses.circle(pose.x + 16, pose.y - 65, 3).fill({ color: 0x9ce5c8, alpha: .6 + Math.sin(now / 280) * .3 });
        this.responses.moveTo(pose.x + 10, pose.y - 50).lineTo(pose.x + 10, pose.y - 43).stroke({ color: 0x98714d, width: 1.7 });
        this.responses.moveTo(pose.x + 10, pose.y - 79).quadraticCurveTo(pose.x + 15, pose.y - 84 - Math.sin(now / 350) * 2, pose.x + 11, pose.y - 91).stroke({ color: 0xc2d9de, alpha: .6, width: 1.2 });
      } else if (pose.activity === 'present') {
        this.responses.moveTo(pose.x + 10, pose.y - 40).lineTo(pose.x + 25, pose.y - 42 - Math.sin(now / 500) * 3).stroke({ color: 0x63999a, width: 1.5 });
      }
      const entity = this.entities.get(id);
      if (entity && pose.stage === 'rising') entity.scale.y = .97;
    }
    const world = this.runtime.readWorld(), actors = new Map(world.actors.map(actor => [actor.id, actor])), props = new Map(world.props.map(prop => [prop.id, prop]));
    for (const [id, effect] of this.activity) {
      const actor = actors.get(id);
      const prop = props.get(actor?.homeId || '');
      const entity = this.entities.get(id); if (!actor || !prop || !entity) continue;
      const emphasized = id === this.hovered || id === this.focused || this.selected.includes(id);
      const previous = this.emphasis.get(id) || 0;
      const amount = this.reduced || now >= this.hoverUntil ? Number(emphasized) : previous + (Number(emphasized) - previous) * .28;
      this.emphasis.set(id, amount);
      entity.scale.x = Math.sign(entity.scale.x || 1) * (1 + amount * .045);
      if (entity.data.state !== 'idle') entity.scale.y = 1 + amount * .045;
      const pixel = propPixels(prop);
      effect.position.set(pixel.x, pixel.y); effect.zIndex = pixel.y + 1; effect.clear();
      const presence = this.presence.get(id);
      const stale = presence && (presence.expired || presence.disconnected || presence.status === 'offline');
      const screen = stale ? 'off' : this.screens.get(id) || (actor.presentation.status === 'idle' ? 'off' : actor.presentation.status);
      const working = screen === 'working', thinking = screen === 'thinking';
      const done = this.doneLabels.get(id);
      if (done) { done.visible = screen === 'done'; done.position.set(pixel.x - 10, pixel.y - 34); done.zIndex = pixel.y + 2; }
      if (screen !== 'off') {
        const role = String(prop.state.role || 'general') as ReturnType<typeof officeRole>['role'];
        this.artwork.screen(effect, -10, -34, 65, 40, role, screen !== 'done');
        if (screen === 'done') effect.roundRect(-40.5, -52, 61, 35, 2).fill(0x264b54);
        if (role === 'engine' || role === 'frontend') this.artwork.screen(effect, 40, -29, 31, 32, role === 'engine' ? 'backend' : 'frontend', working || thinking);
      }
      const pulse = .5 + Math.sin(now / 1800 + pixel.x) * .5;
      if (working || thinking) effect.poly([-40, -10, 25, -10, 34, 18, -35, 18]).fill({ color: 0x8cbfea, alpha: .08 + pulse * .035 });
      if (working) {
        const phase = this.reduced ? 0 : now / 900 % 1;
        if (prop.state.role === 'frontend' || prop.state.role === 'product' || prop.state.role === 'engine') {
          for (let bar = 0; bar < 5; bar++) effect.rect(-12 + bar * 5, -27 - Math.sin(now / 900 + bar) * 2, 3, 3 + bar % 3).fill({ color: 0x93cbb9, alpha: .7 });
        } else for (let row = 0; row < 5; row++) effect.rect(-32 + row % 2 * 4, -47 + ((row + phase) % 5) * 4, 12 + row % 3 * 5, 1).fill({ color: 0xb7e0bf, alpha: .6 });
      }
      if (working && !this.reduced && Math.floor(now / 1600) % 9 === 8 && entity.data.seated) entity.updateVisuals('thinking', 0);
      if (amount > .005) effect.roundRect(-78, -59, 156, 137, 10).stroke({ color: 0x6d998a, alpha: amount * .65, width: 1.5 });
      const label = this.labels.get(id);
      if (label) { label.dataset.emphasis = String(emphasized); label.dataset.talking = String(entity.data.state === 'talking'); }
    }
  }
  private drawLight() {
    this.light.clear();
    const width = this.displaySize.width * CELL_PIXELS, height = this.displaySize.height * CELL_PIXELS;
    const drift = this.reduced ? 0 : Math.sin(performance.now() / 18000) * 5;
    this.light.poly([width * .24, 114, width * .46, 114, width * .56 + drift, height - 25, width * .35 + drift, height - 25]).fill({ color: 0xfff6d9, alpha: .04 + drift * .002 });
  }
  private drawSelection() {
    this.highlight.clear();
    const data = this.runtime.readWorld();
    for (const actor of data.actors.filter(actor => this.selected.includes(actor.id))) {
      const desk = data.props.find(prop => prop.id === actor.homeId);
      if (desk) { const pixel = propPixels(desk); this.highlight.roundRect(pixel.x - 79, pixel.y - 63, 158, 147, 10).fill({ color: 0x779b8c, alpha: .1 }); }
    }
  }
  dispose() {
    this.disposed = true;
    this.clearTransitions();
    if (this.breathTimer !== undefined) clearTimeout(this.breathTimer); this.breathTimer = undefined;
    this.overlay?.remove(); this.overlay = undefined;
    if (this.maintenance !== undefined) clearTimeout(this.maintenance);
    this.maintenance = undefined;
    this.observer?.disconnect(); this.unsubscribe?.();
    this.app?.ticker.stop(); this.app?.ticker.remove(this.onTick);
    if (this.app) StarmapScene.applications--;
    this.app?.destroy(true, { children: true }); this.app = undefined;
    this.textures?.dispose(); this.textures = undefined; this.artwork.dispose();
    this.unsubscribe = undefined; this.observer = undefined; this.diagnostics();
  }
}
