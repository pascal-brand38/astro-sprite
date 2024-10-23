// Copyright (c) Pascal Brand
// MIT License

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { AstroConfig, AstroIntegration } from 'astro';
import sharp from 'sharp'
import { fileURLToPath } from 'url'

interface srcType {
  dir: string,
  extension: string,
}

interface dstType {
  spriteFile: string,
  cssMainClass: string,
  cssFile: string,
  cssPrefix: string,
  cssSelector: string,
}

export interface spriteConfigType {
  src: srcType,
  dst: dstType,
}

const defaultConfig: spriteConfigType = {
  src: {
    dir: 'assets/astro-sprite',
    extension: '.png',
  },
  dst: {
    spriteFile: 'img/astro-sprite.png',
    cssMainClass: '.astro-sprite',
    cssFile: 'css/astro-sprite.css',
    cssPrefix: '.astro-sprite-',
    cssSelector: '',
  }
}

interface iconType {
  name: string,
  fullName: string,
  width: number,
  height: number,
}

// read all icons data
async function getIcons(config: spriteConfigType, srcDir: string): Promise<iconType[]> {
  const dirIcons = path.join(srcDir, config.src.dir)
  let icons: iconType[] = []
  await Promise.all(fs.readdirSync(dirIcons).map(async (file) => {
    const fullName = path.join(dirIcons, file);
    if (fs.statSync(fullName).isFile()) {
      // it is a file. Checks it ends with inputExtension
      if (file.endsWith(config.src.extension)) {
        const image = sharp(fullName);
        const metadata = await image.metadata()
        icons.push( {
          name: path.parse(file).name,
          fullName,
          width: metadata.width ? metadata.width : 0,
          height: metadata.height ? metadata.height : 0,
        } )
      }
    }
  }))
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
function writeCss(positions: positionType[], config: spriteConfigType, srcDir: string, spriteFile: string): string {
  const gethash = (filename:string) => {
    const chunkSize = 10 * 1024*1024        // read files by 10MB chunk size
    const chunkBuffer = Buffer.alloc(chunkSize);

    let fp = fs.openSync(filename, 'r');
    let bytesRead = 0;
    let offset = 0
    let sha = crypto.createHash('sha256')

    while(bytesRead = fs.readSync(fp, chunkBuffer, 0, chunkSize, offset)) {
      const data = chunkBuffer.subarray(0, bytesRead)
      sha.update(data)
      offset += bytesRead
    }

    fs.closeSync(fp)
    return sha.digest("hex");
  }

  // TODO: getHash() should be the same when using same sprite, even if generated at different time
  let cssText = `/* Auto-generated by astro-sprite */\n`
  cssText += `${config.dst.cssMainClass} { background-image:url(/${config.dst.spriteFile}?v=${gethash(spriteFile).slice(0,6)});}\n`
  positions.forEach(position => {
    cssText += `${config.dst.cssPrefix}${position.name}${config.dst.cssSelector} { background-position: -${position.left}px -${position.top}px; width: ${position.width}px; height: ${position.height}px; }\n`
  })

  const cssFile = path.join(srcDir, config.dst.cssFile)
  createDirOfFile(cssFile)
  fs.writeFileSync(cssFile, cssText)
  return cssFile
}

async function writeSprite(positions: positionType[], config: spriteConfigType, publicDir: string): Promise<string> {
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
  return spriteFile
}

async function runAstroSprite(config: spriteConfigType, srcDir: string, publicDir: string) {
  const icons = await getIcons(config, srcDir)
  const positions = getPositions(icons)
  const spriteFile = await writeSprite(positions, config, publicDir)
  writeCss(positions, config, srcDir, spriteFile)   // must write css after the sprite to know the sprite sha1
}

// https://stackoverflow.com/questions/41980195/recursive-partialt-in-typescript
type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>;
};

// initialize the astro sprite integration
function astroSprite(config: RecursivePartial<spriteConfigType>): AstroIntegration {
  let spriteConfig:spriteConfigType = defaultConfig
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

export default astroSprite
