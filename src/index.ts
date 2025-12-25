// Copyright (c) Pascal Brand
// MIT License

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { AstroConfig, AstroIntegration } from 'astro';
import sharp from 'sharp'
import { fileURLToPath } from 'url'

// https://stackoverflow.com/questions/57835286/deep-recursive-requiredt-on-specific-properties
// DeepRequired<spriteConfigType> makes all properties of spriteConfigType required, recursively
type DeepRequired<T> = Required<{
    [K in keyof T]: T[K] extends Required<T[K]> ? T[K] : DeepRequired<T[K]>
}>

export interface spriteConfigType {
  /** properties related to the source icons */
  src?: {
    /** directory where the single icons are located, relative to the astro srcDir
     * @default 'assets/astro-sprite'
     */
    dir?: string,
    /** all files in src.dir with the provided extension will be used the sprite.
     * .webp and .avif can be used. It is used when correspondence is not provided.
     * @default '.png'
     */
    extension?: string,
    /** correspondence between icon names and file names
     * only file names in the correspondence will be used in the sprite.
     */
    correspondence?: { iconName: string, fileName: string }[] | null,
  },
  /** properties related to the output of the integration */
  dst?: {
    /** the output sprite filename, relative to the astro publicDir.
     * A .webp or .avif file can be used
     * @default 'img/astro-sprite.png'
     */
    spriteFile?: string,
    /** the css class that contains the property backgroud: url();
     * @default '.astro-sprite'
    */
    cssMainClass?: string,
    /** the output css filename, relative to the astro srcDir
     * @default 'css/astro-sprite.css'
    */
    cssFile?: string,
    /** each icon will be related to a css class, prefixed by this property, and
     * suffixed by the icon file name
     * @default '.astro-sprite-'
    */
    cssPrefix?: string,
    /** a css selector added to each icon class, such as ::before
     * @default ''
    */
    cssSelector?: string,
    /** an astro component, to be use in the head section of the html, in order
     * to preload the sprite, not waiting for the css to be loaded. Set it to undefined not
     * to generate this file.
     * @default 'components/SpritePreload.astro'
     */
    preloadFile?: string | undefined,
    /** when true, add valuable rules to the cssMainClass to use sprite in span
     * @default false
    */
    useInSpan?: boolean,
  },
  /** verbose mode on or off
   * @default true
  */
  verbose?: boolean,
}


const defaultConfig: DeepRequired<spriteConfigType> = {
  src: {
    dir: 'assets/astro-sprite',
    extension: '.png',
    correspondence: null,
  },
  dst: {
    spriteFile: 'img/astro-sprite.png',
    cssFile: 'css/astro-sprite.css',
    preloadFile: 'components/SpritePreload.astro',
    cssMainClass: '.astro-sprite',
    cssPrefix: '.astro-sprite-',
    cssSelector: '',
    useInSpan: false,
  },
  verbose: true,
}

interface iconType {
  name: string,
  fullName: string,
  width: number,
  height: number,
}

// read all icons data
async function getIcons(config: DeepRequired<spriteConfigType>, srcDir: string): Promise<iconType[]> {
  const dirIcons = path.join(srcDir, config.src.dir)
  let maps: (iconType | undefined)[] | undefined = undefined
  if (config.src.correspondence) {
    // parse the correspondence list
    maps = await Promise.all(config.src.correspondence.map(async (corresp) => {
      const fullName = path.join(dirIcons, corresp.fileName);
      if (fs.statSync(fullName).isFile()) {
        const image = sharp(fullName);
        const metadata = await image.metadata()
        const icon: iconType = {
          name: corresp.iconName,
          fullName,
          width: metadata.width ? metadata.width : 0,
          height: metadata.height ? metadata.height : 0,
        }
        return icon
      } else {
        return undefined
      }
    }))
  } else {
    // read all files in the directory, ending with the provided extension
    maps = await Promise.all(fs.readdirSync(dirIcons).map(async (file) => {
      const fullName = path.join(dirIcons, file);
      if (fs.statSync(fullName).isFile() && file.endsWith(config.src.extension)) {
        const image = sharp(fullName);
        const metadata = await image.metadata()
        const icon: iconType = {
          name: path.parse(file).name,
          fullName,
          width: metadata.width ? metadata.width : 0,
          height: metadata.height ? metadata.height : 0,
        }
        return icon
      } else {
        return undefined
      }
    }))
  }
  const icons: iconType[] = maps.filter(map => map!==undefined)
  return icons
}

interface positionType {
  input: string,
  name: string,
  left: number,
  top: number,
  height: number,
  width: number,
}

function verbose(config:spriteConfigType, text: string) {
  if (config.verbose) {
    console.log(`[astro-sprite] ${text}`)
  }
}

// get the positions of all icons in the sprite
function getPositions(icons: iconType[]) {
  let positions: positionType[] = []
  let left = 0
  icons.forEach(icon => {
    // input, left and top are used by further call to sharp.composite()
    // do not change these property name
    positions.push({ input: icon.fullName, name: icon.name, left: left, top: 0, height: icon.height, width: icon.width })
    left += icon.width
  })
  return positions
}

function createDirOfFile(fullName: string) {
  const dirname = path.dirname(fullName)
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

// write the resulting css
function writeCss(positions: positionType[], config: DeepRequired<spriteConfigType>, srcDir: string, hash: string): string {
  let cssText = `/* Auto-generated by astro-sprite */\n`
  let spanCss = ''
  if (config.dst.useInSpan) {
    spanCss = 'display:inline-block; vertical-align:middle; content: " ";'

  }
  cssText += `${config.dst.cssMainClass}${config.dst.cssSelector} { ${spanCss} background-image:url(/${config.dst.spriteFile}?v=${hash});}\n`
  positions.forEach(position => {
    cssText += `${config.dst.cssPrefix}${position.name}${config.dst.cssSelector} { background-position: -${position.left}px -${position.top}px; width: ${position.width}px; height: ${position.height}px; }\n`
  })

  const cssFile = path.join(srcDir, config.dst.cssFile)
  createDirOfFile(cssFile)
  fs.writeFileSync(cssFile, cssText)
  verbose(config, `Generate ${cssFile}`)
  return cssFile
}

async function writeSprite(positions: positionType[], config: DeepRequired<spriteConfigType>, publicDir: string): Promise<{spriteFile: string, hash: string}> {
  const getHash = (buffer: Buffer) => {
    let sha = crypto.createHash('sha256')
    sha.update(buffer)
    return sha.digest("hex").slice(0,6);
  }

  const sprite = sharp({
    create: {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      channels: 4,
      height: Math.max(...positions.map(position => position.top + position.height)),
      width: Math.max(...positions.map(position => position.left + position.width)),
    },
  });

  sprite.composite(positions);

  const spriteFile = path.join(publicDir, config.dst.spriteFile)
  createDirOfFile(spriteFile)
  await sprite.toFile(spriteFile)
  const { data, info } = await sprite.toBuffer({resolveWithObject: true})
  const hash = getHash(data)
  verbose(config, `Generate ${spriteFile}`)
  verbose(config, `         hash=${hash}`)
  return { spriteFile, hash }
}

function writePreload(config: DeepRequired<spriteConfigType>, srcDir: string, hash: string): string | undefined {
  if (config.dst.preloadFile) {
    let preloadText = '---\n'
    preloadText += `// Auto-generated by astro-sprite\n`
    preloadText += '---\n'
    preloadText += `<link rel='preload'   href='/${config.dst.spriteFile}?v=${hash}' as="image" media='all'/>\n`

    const preloadFile = path.join(srcDir, config.dst.preloadFile)
    createDirOfFile(preloadFile)
    fs.writeFileSync(preloadFile, preloadText)
    verbose(config, `Generate ${preloadFile}`)
    return preloadFile
  } else {
    verbose(config, `No preload component created`)
    return undefined
  }
}

async function runAstroSprite(config: DeepRequired<spriteConfigType>, srcDir: string, publicDir: string) {
  const icons = await getIcons(config, srcDir)
  const positions = getPositions(icons)
  const { spriteFile, hash } = await writeSprite(positions, config, publicDir)
  writeCss(positions, config, srcDir, hash)
  writePreload(config, srcDir, hash)
}

// initialize the astro sprite integration
function sprite(config: spriteConfigType = {}): AstroIntegration {
  let spriteConfig:DeepRequired<spriteConfigType> = defaultConfig
  spriteConfig.src = { ...spriteConfig.src, ...config.src}
  spriteConfig.dst = { ...spriteConfig.dst, ...config.dst}

  return {
    name: 'astro-sprite',
    hooks: {
      "astro:config:done": function ({ config: astroConfig }: { config: AstroConfig} ) {
        runAstroSprite(spriteConfig, fileURLToPath(astroConfig.srcDir), fileURLToPath(astroConfig.publicDir))
      },
    },
  }
}

export default sprite
