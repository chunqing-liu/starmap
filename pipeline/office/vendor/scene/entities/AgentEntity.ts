import { Container, Graphics, Rectangle, Sprite, type Texture } from 'pixi.js'
import type { Agent, AgentState } from '../../types/agent'
import {
  resolveWalkViewFacing,
  viewFacingToLR,
} from '../systems/movementFacing'
import { ApartmentCharacter } from '../characters/ApartmentCharacter'
import { transformWorkSurface, type WorkSurface } from '../characters/workSurface'
import { shouldSitAtDesk } from '../characters/apartmentFrames'
import { isApartmentReady } from '../assets/loadApartmentAssets'
import { Bubble } from '../ui/Bubble'
import { StatusLabel } from '../ui/StatusLabel'
import { drawPixelActor } from '../../../pixel-art'

export class AgentEntity extends Container {
  readonly agentId: string
  private agent: Agent
  private character: ApartmentCharacter | null = null
  private fallbackBody: Graphics | null = null
  private fallbackScarf: Graphics | null = null
  private statusLabel: StatusLabel
  private bubble: Bubble
  private textureBody?: Sprite
  private walkPhase = 0
  private animationX: number
  private animationY: number

  constructor(agent: Agent, frameResourcesOwned = true, private frameTexture?: (state: AgentState, phase: number, color: number, seated: boolean, facing: string) => Texture) {
    super()
    this.agentId = agent.id
    this.agent = { ...agent }
    this.animationX = agent.x
    this.animationY = agent.y

    this.statusLabel = new StatusLabel(agent.name)
    this.statusLabel.visible = !this.frameTexture
    this.bubble = new Bubble()

    if (frameResourcesOwned && isApartmentReady(agent.appearanceId ?? agent.id)) {
      this.character = new ApartmentCharacter(agent.appearanceId ?? agent.id)
      if (this.character.isReady) {
        this.character.setAgentColor(agent.color)
        this.character.setFacing(agent.facing)
        this.character.setViewFacing(agent.viewFacing ?? 'front')
        this.syncCharacterState()
        this.addChild(this.character, this.statusLabel, this.bubble)
      } else {
        this.character.destroy()
        this.character = null
        this.initFallbackGraphics()
      }
    } else {
      this.initFallbackGraphics()
    }

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.hitArea = new Rectangle(-34, -92, 68, 124)

    this.syncVisual()
    this.position.set(agent.x, agent.y)
  }

  get data(): Agent {
    return this.agent
  }

  apply(patch: Partial<Agent>) {
    const previousName = this.agent.name
    const previousBubble = this.agent.bubbleText
    const prevState = this.agent.state
    const prevFacing = this.agent.facing
    const prevViewFacing = this.agent.viewFacing
    const prevColor = this.agent.color
    const prevCustomAnimation = this.agent.customAnimation
    this.agent = { ...this.agent, ...patch }
    if (previousName !== this.agent.name) this.statusLabel.setName(this.agent.name)
    if (previousBubble !== this.agent.bubbleText) {
      if (this.agent.bubbleText) this.bubble.show(this.agent.bubbleText, 86400)
      else this.bubble.hide()
    }

    if (this.character) {
      this.character.setAtDesk(shouldSitAtDesk(this.agent))
      if (patch.viewFacing != null && patch.viewFacing !== prevViewFacing) {
        this.character.setViewFacing(patch.viewFacing)
      }
      if (patch.facing != null && patch.facing !== prevFacing) {
        this.character.setFacing(patch.facing)
      }
      if (
        (patch.state != null && patch.state !== prevState) ||
        patch.customAnimation !== prevCustomAnimation
      ) {
        this.syncCharacterState()
      }
      if (patch.color != null && patch.color !== prevColor) {
        this.character.setAgentColor(patch.color)
      }
      this.updateOverlayPositions()
    } else {
      this.syncVisual()
    }
  }

  setPosition(x: number, y: number) {
    this.agent.x = x
    this.agent.y = y
    this.position.set(x, y)
  }

  showBubble(text: string, duration = 4) {
    this.agent.bubbleText = text
    this.bubble.show(text, duration)
    this.character?.setSpeechText(text)
    this.updateOverlayPositions()
  }

  hideBubble() {
    this.agent.bubbleText = undefined
    this.bubble.hide()
    this.character?.setSpeechText(undefined)
  }

  playCustomAnimation(animation: string, task?: string) {
    this.agent = {
      ...this.agent,
      state: 'talking',
      currentTask: task,
      customAnimation: animation,
      viewFacing: 'front',
      facing: 1,
      targetX: undefined,
      targetY: undefined,
      walkPath: undefined,
      walkPathIndex: undefined,
      mission: undefined,
      bubbleText: undefined,
    }

    if (this.character) {
      this.character.setViewFacing('front')
      this.character.setFacing(1)
      this.character.playAnimation(animation)
      this.updateOverlayPositions()
      return
    }

    this.syncVisual()
  }

  setWorkSurface(surface?: WorkSurface) {
    this.character?.setWorkSurface(surface && transformWorkSurface(surface, 1, -this.agent.x, -this.agent.y))
  }

  updateVisuals(state: AgentState, dt: number) {
    const distanceMoved = Math.hypot(this.agent.x - this.animationX, this.agent.y - this.animationY)
    this.animationX = this.agent.x
    this.animationY = this.agent.y
    if (this.character) {
      if (
        state === 'walking' &&
        this.agent.targetX != null &&
        this.agent.targetY != null
      ) {
        // Docking supplies its own facing; a raw grid target is not the next visual waypoint.
        const viewFacing = this.agent.seatTransition && this.agent.viewFacing
          ? this.agent.viewFacing
          : resolveWalkViewFacing(
            this.agent.targetX - this.agent.x,
            this.agent.targetY - this.agent.y,
            this.agent.viewFacing ?? 'front',
          )
        this.agent.viewFacing = viewFacing
        this.agent.facing = viewFacingToLR(viewFacing)
        this.character.setViewFacing(viewFacing)
        this.character.setFacing(this.agent.facing)
      } else if ((state === 'working' || state === 'thinking') && this.agent.seated !== true) {
        if (this.agent.viewFacing !== 'back') {
          this.agent.viewFacing = 'back'
          this.character.setViewFacing('back')
        }
      }
      this.syncCharacterState(state)
      this.character.update(dt, distanceMoved)
    } else {
      this.walkPhase += dt * 8
      this.drawFallbackBody(state, 0)
    }

    if (this.blendBody) {
      this.blendRemaining = Math.max(0, this.blendRemaining - dt)
      this.blendBody.alpha = this.blendRemaining / .24
      if (!this.blendRemaining) this.finishVisualTransition()
    }
    this.bubble.update(dt)
    this.statusLabel.setState(state)
    this.statusLabel.setTask(
      state === 'working' || state === 'thinking' ? this.agent.currentTask : undefined,
    )
    this.updateOverlayPositions()
  }

  private updateOverlayPositions() {
    const crownTopY = this.character?.getHeadOffsetY() ?? -58
    this.statusLabel.layout(crownTopY)
    const labelTopY = this.statusLabel.getLabelTopY(crownTopY)
    const gapAboveLabel = 24
    this.bubble.position.set(
      0,
      labelTopY - gapAboveLabel - Bubble.TAIL_TIP_Y,
    )
  }

  private syncCharacterState(state = this.agent.state) {
    this.character?.setAtDesk(shouldSitAtDesk(this.agent))
    this.character?.setSeatTransition(this.agent.seatTransition)
    this.character?.setSpeechText(this.agent.bubbleText)
    this.character?.playState(state, this.agent.customAnimation)
  }

  private syncVisual() {
    this.statusLabel.setName(this.agent.name)
    this.statusLabel.setState(this.agent.state)
    this.statusLabel.setTask(
      this.agent.state === 'working' || this.agent.state === 'thinking'
        ? this.agent.currentTask
        : undefined,
    )
    if (this.agent.bubbleText) {
      this.bubble.show(this.agent.bubbleText)
    }
    if (this.character) {
      this.syncCharacterState()
      this.character.setFacing(this.agent.facing)
      this.character.setViewFacing(this.agent.viewFacing ?? 'front')
      this.character.setAgentColor(this.agent.color)
    } else {
      this.drawFallbackBody(this.agent.state, 0)
    }
    this.updateOverlayPositions()
  }

  private initFallbackGraphics() {
    this.fallbackBody = new Graphics()
    this.fallbackScarf = new Graphics()
    this.addChild(this.fallbackBody, this.fallbackScarf, this.statusLabel, this.bubble)
  }

  private blendBody?: Sprite
  private blendRemaining = 0
  private frameState = ''

  finishVisualTransition() {
    this.blendBody?.destroy()
    this.blendBody = undefined
    this.blendRemaining = 0
  }

  private drawFallbackBody(state: AgentState, _bob: number) {
    if (!this.fallbackBody || !this.fallbackScarf) return
    this.fallbackScarf.clear()
    if (this.frameTexture) {
      const texture = this.frameTexture(state, this.walkPhase, this.agent.color, this.agent.seated === true, this.agent.viewFacing || 'front')
      if (!this.textureBody) { this.textureBody = new Sprite(texture); this.textureBody.position.set(-28, -44); this.addChildAt(this.textureBody, 0) }
      const frameState = state + ':' + this.agent.seated + ':' + this.agent.viewFacing
      if (state !== 'walking' && this.frameState && !this.frameState.startsWith('walking:') && this.frameState !== frameState) {
        this.finishVisualTransition()
        this.blendBody = new Sprite(this.textureBody.texture)
        this.blendBody.position.copyFrom(this.textureBody.position)
        this.addChild(this.blendBody)
        this.blendRemaining = .24
      }
      this.frameState = frameState
      this.textureBody.texture = texture
      this.fallbackBody.visible = false
    } else drawPixelActor(this.fallbackBody, state, this.walkPhase, this.agent.color, this.agent.seated === true)
    this.scale.x = this.agent.facing
  }
}
