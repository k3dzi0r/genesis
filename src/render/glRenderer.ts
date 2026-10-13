/**
 * Renderer WebGL2: tło (żyzność + zasoby) jako tekstury oraz organizmy rysowane
 * instancingowo (jedno wywołanie rysowania na wszystkie). Brak zależności od silnika symulacji —
 * dostaje wyłącznie spakowaną migawkę (stride 8 floatów, patrz protocol.FrameMsg).
 *
 * Uzasadnienie wyboru zamiast PixiJS: jeden bufor instancji i jeden shader dają stały narzut
 * niezależny od liczby organizmów (10⁵+ bez grafu sceny), a cała potrzebna funkcjonalność
 * (dysk, „nos” kierunku, rdzeń energii, pierścień sensora) to ~120 linii GLSL.
 */

export interface ViewState {
  /** środek widoku w jednostkach świata */
  cx: number;
  cy: number;
  /** piksele CSS na jednostkę świata */
  zoom: number;
}

export interface RenderOptions {
  showFood: boolean;
  showNiche: boolean;
  environmentMap?: 'none' | 'biome' | 'temperature';
  sensors: boolean;
  energy: boolean;
}

const BG_VS = `#version 300 es
out vec2 v_ndc;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_ndc = p * 2.0 - 1.0;
  gl_Position = vec4(v_ndc, 0.0, 1.0);
}`;

const BG_FS = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform vec3 u_view;
uniform vec2 u_world;
uniform sampler2D u_fert;
uniform sampler2D u_food;
uniform sampler2D u_foodB;
uniform sampler2D u_obstacles;
uniform sampler2D u_niche;
uniform sampler2D u_biome;
uniform sampler2D u_temperature;
uniform float u_environmentMap;
uniform float u_showNiche;
uniform float u_showFood;
in vec2 v_ndc;
out vec4 o;
void main(){
  vec2 w = vec2(u_view.x + v_ndc.x * u_res.x * 0.5 / u_view.z, u_view.y - v_ndc.y * u_res.y * 0.5 / u_view.z);
  vec2 uv = w / u_world;
  vec3 bg = vec3(0.030, 0.042, 0.058);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    o = vec4(bg * 0.55, 1.0);
    return;
  }
  float fert = texture(u_fert, uv).r;
  float food = texture(u_food, uv).r;
  vec3 col = bg + vec3(0.012, 0.050, 0.060) * fert;
  if (u_environmentMap > 0.5 && u_environmentMap < 1.5) {
    float biome = floor(texture(u_biome, uv).r * 2.0 + 0.5);
    col = biome < 0.5 ? vec3(0.055,0.19,0.13) : biome < 1.5 ? vec3(0.07,0.12,0.27) : vec3(0.27,0.13,0.045);
  } else if (u_environmentMap > 1.5) {
    col = mix(vec3(0.04,0.10,0.30),vec3(0.33,0.09,0.025),texture(u_temperature,uv).r);
  }
  float f = clamp(food, 0.0, 1.0);
  col += u_showFood * (vec3(0.02, 0.20, 0.17) * f + vec3(0.10, 0.45, 0.28) * f * f);
  float foodB = texture(u_foodB, uv).r;
  col += u_showFood * vec3(0.50, 0.24, 0.06) * foodB;
  col += u_showNiche * vec3(0.24, 0.08, 0.42) * texture(u_niche, uv).r;
  col = mix(col, vec3(0.20, 0.24, 0.30), texture(u_obstacles, uv).r);
  // cienka ramka świata
  vec2 d = min(uv, 1.0 - uv) * u_world * u_view.z;
  float edge = 1.0 - smoothstep(0.0, 1.5, min(d.x, d.y));
  col = mix(col, vec3(0.25, 0.55, 0.65), edge * 0.8);
  o = vec4(col, 1.0);
}`;

const ORG_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 a_pos;
layout(location=2) in float a_r;
layout(location=3) in vec2 a_head;
layout(location=4) in vec4 a_color;
layout(location=5) in float a_energy;
layout(location=6) in float a_sense;
uniform vec2 u_res;
uniform vec3 u_view;
uniform float u_pass;
out vec2 v_local;
out vec4 v_color;
out vec2 v_head;
out float v_energy;
out float v_rpx;
out float v_rel;
void main(){
  float rBody = max(a_r, 3.0 / u_view.z);
  float rQuad = u_pass < 0.5 ? rBody * 1.25 : a_sense;
  vec2 world = a_pos + a_corner * rQuad;
  vec2 px = (world - u_view.xy) * u_view.z;
  gl_Position = vec4(px.x / (u_res.x * 0.5), -px.y / (u_res.y * 0.5), 0.0, 1.0);
  v_local = a_corner;
  v_color = a_color;
  v_head = a_head;
  v_energy = a_energy;
  v_rpx = rQuad * u_view.z;
  v_rel = rBody / rQuad;
}`;

const ORG_FS = `#version 300 es
precision highp float;
uniform float u_pass;
uniform float u_energyMode;
in vec2 v_local;
in vec4 v_color;
in vec2 v_head;
in float v_energy;
in float v_rpx;
in float v_rel;
out vec4 o;
void main(){
  float d = length(v_local);
  float aa = 1.0 / max(v_rpx, 1.0);
  if (u_pass > 0.5) {
    float ring = 1.0 - smoothstep(0.0, 2.0 * aa + 0.004, abs(d - 1.0));
    o = vec4(v_color.rgb, 0.22 * ring);
    return;
  }
  float body = 1.0 - smoothstep(v_rel - aa, v_rel + aa, d);
  if (body <= 0.0) discard;
  vec3 c = v_color.rgb;
  float a = body;
  if (u_energyMode > 0.5) {
    float core = clamp(v_energy, 0.0, 1.0);
    float cr = v_rel * sqrt(core);
    float inCore = 1.0 - smoothstep(cr - aa, cr + aa, d);
    c = mix(c * 0.28, c, inCore);
  } else {
    c *= 0.82 + 0.28 * (1.0 - d / max(v_rel, 0.001));
  }
  // rim
  float rim = smoothstep(v_rel * 0.78, v_rel, d);
  c = mix(c, vec3(0.02, 0.03, 0.04), rim * 0.55);
  // nos: kierunek ruchu
  float nd = length(v_local - v_head * v_rel * 0.6);
  float nose = 1.0 - smoothstep(v_rel * 0.17 - aa, v_rel * 0.17 + aa, nd);
  c = mix(c, vec3(1.0), nose * 0.92);
  o = vec4(c, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program: ${gl.getProgramInfoLog(p)}`);
  return p;
}

export class GlRenderer {
  private gl!: WebGL2RenderingContext;
  private bg!: WebGLProgram;
  private org!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private quadBuf!: WebGLBuffer;
  private instBuf!: WebGLBuffer;
  private texFert!: WebGLTexture;
  private texFood!: WebGLTexture;
  private texFoodB!: WebGLTexture;
  private texObstacles!: WebGLTexture;
  private texNiche!: WebGLTexture;
  private texBiome!: WebGLTexture;
  private texTemperature!: WebGLTexture;
  private environment: { biome: Uint8Array; temperature: Uint8Array } | null = null;
  private layers: { foodB: Uint8Array; obstacles: Uint8Array; niche: Uint8Array } | null = null;
  private worldW = 800;
  private worldH = 800;
  private nx = 1;
  private ny = 1;
  private count = 0;
  private fert: Uint8Array | null = null;
  private food: Uint8Array | null = null;
  private inst: Float32Array | null = null;
  private lost = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 niedostępne w tej przeglądarce');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.initGl();
      if (this.fert) this.uploadTex(this.texFert, this.fert);
      if (this.food) this.uploadTex(this.texFood, this.food);
      if (this.layers) this.setLayers(this.layers.foodB, this.layers.obstacles, this.layers.niche);
      if (this.environment) { this.uploadTex(this.texBiome,this.environment.biome); this.uploadTex(this.texTemperature,this.environment.temperature); }
    });
    this.initGl();
  }

  private initGl(): void {
    const gl = this.gl;
    this.bg = program(gl, BG_VS, BG_FS);
    this.org = program(gl, ORG_VS, ORG_FS);
    this.vao = gl.createVertexArray()!;
    this.quadBuf = gl.createBuffer()!;
    this.instBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    const S = 32;
    const attr = (loc: number, size: number, type: number, norm: boolean, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, norm, S, off);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(1, 2, gl.FLOAT, false, 0);
    attr(2, 1, gl.FLOAT, false, 8);
    attr(3, 2, gl.FLOAT, false, 12);
    attr(4, 4, gl.UNSIGNED_BYTE, true, 20);
    attr(5, 1, gl.FLOAT, false, 24);
    attr(6, 1, gl.FLOAT, false, 28);
    gl.bindVertexArray(null);
    this.texFert = this.makeTex();
    this.texFood = this.makeTex();
    this.texFoodB = this.makeTex(); this.texObstacles = this.makeTex(); this.texNiche = this.makeTex();
    this.texBiome = this.makeTex(); this.texTemperature = this.makeTex();
    gl.bindTexture(gl.TEXTURE_2D,this.texBiome);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, this.texObstacles);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    if (this.inst) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.inst, gl.DYNAMIC_DRAW);
    }
  }

  private makeTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private uploadTex(tex: WebGLTexture, data: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.nx, this.ny, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  }

  setWorld(width: number, height: number, nx: number, ny: number, fert: Uint8Array): void {
    this.worldW = width;
    this.worldH = height;
    this.nx = nx;
    this.ny = ny;
    this.fert = fert;
    this.food = new Uint8Array(nx * ny);
    this.count = 0;
    this.setLayers(new Uint8Array(nx * ny), new Uint8Array(nx * ny), new Uint8Array(nx * ny));
    this.setEnvironment(new Uint8Array(nx*ny),new Float32Array(nx*ny));
    if (!this.lost) {
      this.uploadTex(this.texFert, fert);
      this.uploadTex(this.texFood, this.food);
    }
  }

  /** Aktualizacja mapy żyzności (plamy dryfują lub odradzają się). */
  setFert(fert: Uint8Array): void {
    this.fert = fert;
    if (!this.lost) this.uploadTex(this.texFert, fert);
  }

  setFood(food: Uint8Array): void {
    this.food = food;
    if (!this.lost) this.uploadTex(this.texFood, food);
  }

  setLayers(foodB: Uint8Array, obstacles: Uint8Array, niche: Uint8Array): void {
    this.layers = { foodB, obstacles, niche };
    if (!this.lost) {
      this.uploadTex(this.texFoodB, foodB); this.uploadTex(this.texObstacles, obstacles); this.uploadTex(this.texNiche, niche);
    }
  }

  setEnvironment(biome: Uint8Array, temperature: Float32Array): void {
    this.environment = { biome: Uint8Array.from(biome, id=>Math.round(id*127.5)), temperature: Uint8Array.from(temperature,t=>Math.round(Math.max(0,Math.min(1,t/1.2))*255)) };
    if (!this.lost) { this.uploadTex(this.texBiome,this.environment.biome); this.uploadTex(this.texTemperature,this.environment.temperature); }
  }

  setOrganisms(data: Float32Array, n: number): void {
    this.inst = data;
    this.count = n;
    if (this.lost) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  render(view: ViewState, cssW: number, cssH: number, dpr: number, opt: RenderOptions): void {
    if (this.lost) return;
    const gl = this.gl;
    const W = Math.max(1, Math.round(cssW * dpr));
    const H = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.bg);
    gl.uniform2f(gl.getUniformLocation(this.bg, 'u_res'), W, H);
    gl.uniform3f(gl.getUniformLocation(this.bg, 'u_view'), view.cx, view.cy, view.zoom * dpr);
    gl.uniform2f(gl.getUniformLocation(this.bg, 'u_world'), this.worldW, this.worldH);
    gl.uniform1f(gl.getUniformLocation(this.bg, 'u_showFood'), opt.showFood ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texFert);
    gl.uniform1i(gl.getUniformLocation(this.bg, 'u_fert'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texFood);
    gl.uniform1i(gl.getUniformLocation(this.bg, 'u_food'), 1);
    const layers = [this.texFoodB, this.texObstacles, this.texNiche, this.texBiome, this.texTemperature];
    const names = ['u_foodB', 'u_obstacles', 'u_niche', 'u_biome', 'u_temperature'];
    layers.forEach((texture, i) => { gl.activeTexture(gl.TEXTURE2 + i); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(gl.getUniformLocation(this.bg, names[i]), i + 2); });
    gl.uniform1f(gl.getUniformLocation(this.bg, 'u_showNiche'), opt.showNiche ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.bg,'u_environmentMap'),opt.environmentMap==='biome'?1:opt.environmentMap==='temperature'?2:0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (this.count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.org);
      gl.uniform2f(gl.getUniformLocation(this.org, 'u_res'), W, H);
      gl.uniform3f(gl.getUniformLocation(this.org, 'u_view'), view.cx, view.cy, view.zoom * dpr);
      gl.uniform1f(gl.getUniformLocation(this.org, 'u_energyMode'), opt.energy ? 1 : 0);
      gl.bindVertexArray(this.vao);
      if (opt.sensors) {
        gl.uniform1f(gl.getUniformLocation(this.org, 'u_pass'), 1);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
      }
      gl.uniform1f(gl.getUniformLocation(this.org, 'u_pass'), 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.bg);
    gl.deleteProgram(this.org);
    gl.deleteBuffer(this.quadBuf);
    gl.deleteBuffer(this.instBuf);
    gl.deleteTexture(this.texFert);
    gl.deleteTexture(this.texFood); gl.deleteTexture(this.texFoodB); gl.deleteTexture(this.texObstacles); gl.deleteTexture(this.texNiche);
    gl.deleteTexture(this.texBiome); gl.deleteTexture(this.texTemperature);
    gl.deleteVertexArray(this.vao);
  }
}
