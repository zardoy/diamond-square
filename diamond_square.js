'use strict'

const { Vec3 } = require('vec3')
const rand = require('random-seed')

class Perlin {
  constructor (seed, numOctaves = 4) {
    // public fields
    this.numOctaves = numOctaves
    this.seed = seed
    this.rng = rand.create(seed)
    this.xSinAmplitudes = []
    this.xSinOffsets = []
    this.ySinAmplitudes = []
    this.ySinOffsets = []

    for (let i = 0; i < numOctaves; i++) {
      const power = Math.pow(Math.E, i)

      this.xSinAmplitudes.push((i + 1) * (i + 1))
      this.xSinOffsets.push(this.rng(1) * power)

      this.ySinAmplitudes.push((i + 1) * (i + 1))
      this.ySinOffsets.push(this.rng(1) * power)
    }
  }

  // public methods
  value (x, y) {
    if (typeof x === 'string') x = parseInt(x)
    if (typeof y === 'string') y = parseInt(y)

    let value = 0.0
    for (let i = 0; i < this.numOctaves; i++) {
      const power = Math.pow(Math.E, i + 1)
      value += this.xSinAmplitudes[i] * Math.sin((x - this.xSinOffsets[i]) / power)
      value += this.ySinAmplitudes[i] * Math.sin((y - this.ySinOffsets[i]) / power)
    }
    return 1 / (1 + Math.pow(Math.E, value / 70))
  }
}

class Worley {
  constructor (density, seed) {
    // public fields
    this.expectedPoints = 10

    this.batchSize = Math.ceil(Math.sqrt(this.expectedPoints / density) / 2) * 2
    this.density = density
    this.seed = seed

    // private fields
    this.pointCache = {}
  }

  // public methods
  value (x, y) {
    return this._closestDistanceAndPoint(x, y)[1]
  }

  pointIndex (x, y) {
    return this._closestDistanceAndPoint(x, y)[0]
  }

  // private methods
  _closestDistanceAndPoint (x, y) {
    // Get current batch
    const batchX = x - x % this.batchSize
    const batchY = y - y % this.batchSize
    // Make list of points
    const points = []
    for (const [centerX, centerY] of [
      [batchX - this.batchSize, batchY - this.batchSize], [batchX, batchY - this.batchSize], [batchX + this.batchSize, batchX - this.batchSize],
      [batchX - this.batchSize, batchY], [batchX, batchY], [batchX + this.batchSize, batchY],
      [batchX - this.batchSize, batchY + this.batchSize], [batchX, batchY + this.batchSize], [batchX + this.batchSize, batchX + this.batchSize]
    ]) {
      if (!this.pointCache?.[centerX]?.[centerY]) {
        if (!(centerX in this.pointCache)) this.pointCache[centerX] = {}
        const thisPoints = []
        const centeredRng = rand.create(`${this.seed}:${centerX}:${centerY}`)
        let numPointsRandomNumber = centeredRng.random() / Math.pow(Math.E, -this.expectedPoints)
        let numPoints
        let curFactorial = 1
        let curExp = 1
        for (let i = 0; true; i++) {
          if (i !== 0) {
            curFactorial *= i
            curExp *= this.expectedPoints
          }
          numPointsRandomNumber -= curExp / curFactorial
          if (numPointsRandomNumber <= 0) {
            numPoints = i
            break
          }
        }
        for (let i = 0; i < numPoints; i++) {
          thisPoints.push([
            centerX + centeredRng.intBetween(-this.batchSize / 2, this.batchSize / 2),
            centerY + centeredRng.intBetween(-this.batchSize / 2, this.batchSize / 2)
          ])
        }
        this.pointCache[centerX][centerY] = thisPoints
      }
      for (const point of this.pointCache[centerX][centerY]) {
        points.push(point)
      }
    }
    // Now, get closest point
    let closestPointIdx = -1
    let minSqDist = Infinity
    for (const pointXY of points) {
      const dx = pointXY[0] - x
      const dy = pointXY[1] - y
      const sqDist = dx * dx + dy * dy
      if (sqDist < minSqDist) {
        minSqDist = sqDist
        closestPointIdx = pointXY[0] + pointXY[1] // TODO: Better hash
      }
    }
    // Now, get maximum distance
    let maxDist = 0
    for (let i = 0; i < points.length; i++) {
      const point1X = points[i][0]
      const point1Y = points[i][1]
      for (let j = 0; j < i; j++) {
        const point2X = points[j][0]
        const point2Y = points[j][1]
        const dx = point1X - point2X
        const dy = point1Y - point2Y
        const sqDist = dx * dx + dy * dy
        if (maxDist < sqDist) {
          maxDist = sqDist
        }
      }
    }
    return [closestPointIdx, minSqDist / Math.sqrt(maxDist)]
  }
}

function duplicateArr (arr, times) {
  return Array(times).fill([...arr]).reduce((a, b) => a.concat(b))
}

function generation ({ version, seed, worldHeight = 80, minY, waterline = 32, size = 10000000, roughness = null, getRenamedData } = {}) {
  const Chunk = require('prismarine-chunk')(version)
  const blocksCache = {}
  const originalRegistry = require('prismarine-registry')(version)
  const registry = {
    blocksByName: new Proxy({}, {
      get(target, name) {
        if (name in blocksCache) return blocksCache[name]
        const block = getRenamedData('blocks', name, '1.18.2', version)
        blocksCache[name] = originalRegistry.blocksByName[block]
        return blocksCache[name]
      }
    })
  }
  const blocksByName = registry.blocksByName

  if (roughness === null) roughness = size / 500
  const seedRand = rand.create(seed)
  const maxInt = 2 ^ 53 - 1
  const surfaceNoise = new Perlin(seedRand(0, maxInt))
  const soilNoise = new Perlin(seedRand(0, maxInt))
  const soilNoise2 = new Perlin(seedRand(0, maxInt))
  const bedrockNoise = new Perlin(seedRand(0, maxInt))
  const biomeNoise = new Worley(0.00005, seedRand(0, maxInt))

  const biomes = [
    ...duplicateArr(['plains'], 15),
    ...duplicateArr(['forest'], 20),
    ...duplicateArr(['desert'], 10)
  ]

  function generateSimpleChunk (chunkX, chunkZ) {
    const chunk = new Chunk({
      minY,
      worldHeight
    })
    const setBlock = (pos, block) => {
      chunk.setBlockStateId(pos, block.defaultState ?? 0)
    }
    const placements = rand.create(seed + ':' + chunkX + ':' + chunkZ)
    const worldX = chunkX * 16 + size / 2
    const worldZ = chunkZ * 16 + size / 2

    const theFlattening = originalRegistry.supportFeature('theFlattening')
    const levels = []

    for (let x = 0; x < 16; x++) {
      levels.push([])
      for (let z = 0; z < 16; z++) {
        const surfaceNoiseValue = surfaceNoise.value(worldX + x, worldZ + z)
        const bedrockNoiseValue = bedrockNoise.value(worldX + x, worldZ + z)
        const soilNoiseValue = soilNoise.value(worldX + x, worldZ + z)
        const soilNoise2Value = soilNoise2.value(worldX + x, worldZ + z)
        const biomeNoiseIndex = biomeNoise.pointIndex(worldX + x, worldZ + z)

        let biome = biomes[biomeNoiseIndex % biomes.length]

        const bedrock = Math.floor(bedrockNoiseValue * 5)
        const surface = Math.floor(surfaceNoiseValue * worldHeight)
        const soil = surface - 1 - Math.floor(soilNoiseValue * 3)
        const soil2 = soil - 1 - Math.floor(soilNoise2Value * 3)
        const currentWaterline = waterline

        if (surface - waterline < 1) {
          biome = 'ocean'
        }

        levels[x].push({
          surface,
          bedrock,
          soil,
          soil2,
          biome,
          currentWaterline
        })

        // Set sky light
        for (let y = 0; y < 256; y++) {
          chunk.setSkyLight(new Vec3(x, y, z), 15)
        }
      }
    }
    // Bedrock, Stone, soil, surface, and water layers
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const { bedrock, soil, soil2, surface, currentWaterline, biome } = levels[x][z]
        // Bedrock Layer
        for (let y = 0; y <= bedrock; y++) {
          setBlock(new Vec3(x, y, z), blocksByName.bedrock)
        }
        // Stone Layer
        for (let y = bedrock + 1; y <= soil2; y++) {
          // Ores
          let block = blocksByName.stone
          if (y > 20 && placements(40) === 0) block = blocksByName.coal_ore
          else if (y > 20 && placements(50) === 0) block = blocksByName.iron_ore
          else if (y < 20 && placements(100) === 0) block = blocksByName.redstone_ore
          else if (y < 20 && placements(150) === 0) block = blocksByName.diamond_ore
          setBlock(new Vec3(x, y, z), block)
          if (theFlattening) chunk.setBlockStateId(new Vec3(x, y, z), block.defaultState)
        }
        // Soil Layer 2
        for (let y = soil2 + 1; y <= soil; y++) {
          const vec = new Vec3(x, y, z)
          switch (biome) {
            case 'river':
            case 'ocean':
              setBlock(vec, blocksByName.dirt)
              break
            case 'desert':
              setBlock(vec, blocksByName.sandstone)
              break
            case 'mountains':
              setBlock(vec, blocksByName.stone)
              break
            case 'forest':
            case 'plains':
              setBlock(vec, blocksByName.dirt)
              if (theFlattening) chunk.setBlockData(vec, 1)
              break
            default:
              throw new Error('Unknown biome: ' + biome)
          }
        }
        // Soil Layer 1
        for (let y = soil + 1; y < surface; y++) {
          const vec = new Vec3(x, y, z)
          switch (biome) {
            case 'river':
            case 'ocean':
            case 'desert':
              setBlock(vec, blocksByName.sand)
              break
            case 'mountains':
              setBlock(vec, blocksByName.stone)
              break
            case 'forest':
            case 'plains':
              setBlock(vec, blocksByName.dirt)
              if (theFlattening) chunk.setBlockData(vec, 1)
              break
            default:
              throw new Error('Unknown biome: ' + biome)
          }
        }
        // Surface Layer
        switch (biome) {
          case 'river':
          case 'ocean':
          case 'desert':
            setBlock(new Vec3(x, surface, z), blocksByName.sand)
            break
          case 'mountains':
            setBlock(new Vec3(x, surface, z), blocksByName.stone)
            break
          case 'forest':
          case 'plains':
            setBlock(new Vec3(x, surface, z), blocksByName.grass_block ?? blocksByName.grass)
            if (theFlattening) chunk.setBlockData(new Vec3(x, surface, z), 1)
            break
          default:
            throw new Error('Unknown biome: ' + biome)
        }
        // Water Layer
        for (let y = surface + 1; y <= currentWaterline; y++) {
          setBlock(new Vec3(x, y, z), blocksByName.water)
        }
      }
    }
    // Decorations: grass, flowers, sugar cane, cactus, dead bushes, kelp, seagrass, tall seagrass, tall grass, double tall grass, etc...
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const { surface, biome, currentWaterline } = levels[x][z]
        const surfaceVec = new Vec3(x, surface, z)
        const decorationVec = new Vec3(x, surface + 1, z)
        const waterDepth = Math.max(currentWaterline - surface, 0)
        if (['forest', 'plains'].includes(biome) && placements(30) === 0) { // Grass
          const block = blocksByName.short_grass ?? blocksByName.tallgrass ?? blocksByName.grass;
          setBlock(decorationVec, block)
          if (theFlattening) chunk.setBlockStateId(decorationVec, block.defaultState)
        } else if (['plains'].includes(biome) && placements(100) === 0) { // Flowers
          const flower = blocksByName[placements(2) === 0 ? 'dandelion' : 'poppy']
          setBlock(decorationVec, flower)
        } else if (['desert'].includes(biome) && placements(100) === 0) { // Dead bushes
          setBlock(decorationVec, blocksByName.dead_bush)
        } else if ('seagrass' in blocksByName && ['river', 'ocean'].includes(biome) && waterDepth >= 2 && placements(30) === 0) { // Seagrass
          // setBlock(decorationVec, blocksByName.seagrass)
          // if (theFlattening) chunk.setBlockData(decorationVec, 1)
        } else if ('tall_grass' in blocksByName && ['forest', 'plains'].includes(biome) && placements(120) === 0) { // Double tall grass
          const decorationVec2 = decorationVec.offset(0, 1, 0)
          setBlock(decorationVec, blocksByName.tall_grass)
          setBlock(decorationVec2, blocksByName.tall_grass)
          if (theFlattening) {
            chunk.setBlockData(decorationVec, 1)
            chunk.setBlockData(decorationVec2, 0)
          }
        } else if ('tall_seagrass' in blocksByName && ['river', 'ocean'].includes(biome) && waterDepth >= 3 && placements(40) === 0) { // Double tall seagrass
          // const decorationVec2 = decorationVec.offset(0, 1, 0)
          // setBlock(decorationVec, blocksByName.tall_seagrass)
          // setBlock(decorationVec2, blocksByName.tall_seagrass)
          // if (theFlattening) {
          //   chunk.setBlockData(decorationVec, 1)
          //   chunk.setBlockData(decorationVec2, 0)
          // }
        } else if (['river', 'ocean'].includes(biome) && !waterDepth && [[-1, 0, 0], [0, 0, -1], [0, 0, 1], [1, 0, 0]].some(offset => chunk.getBlockType(surfaceVec.offset(...offset)) === blocksByName.water.id) && placements(75) === 0) { // Sugar cane
          const height = placements(3) + 1
          for (let i = 0; i < height; i++) {
            const decorationVec2 = decorationVec.offset(0, i, 0)
            setBlock(decorationVec2, blocksByName.reeds ?? blocksByName.sugar_cane)
          }
        } else if (['desert'].includes(biome) && !waterDepth && [[-1, 0, -1], [-1, 0, 0], [-1, 0, 1], [0, 0, -1], [0, 0, 1], [1, 0, -1], [1, 0, 0], [1, 0, 1]].every(offset => chunk.getBlockType(decorationVec.offset(...offset)) === blocksByName.air.id) && placements(250) === 0) { // Cactus
          const height = placements(3) + 1
          for (let i = 0; i < height; i++) {
            const decorationVec2 = decorationVec.offset(0, i, 0)
            setBlock(decorationVec2, blocksByName.cactus)
            if (theFlattening) chunk.setBlockData(decorationVec2, i === height - 1 ? 1 : 0)
          }
        } else if ('kelp' in blocksByName && ['ocean'].includes(biome) && waterDepth >= 3 && placements(40) === 0) { // Kelp
          // const height = placements(waterDepth - 3) + 2
          // for (let i = 0; i < height - 1; i++) {
          //   const decorationVec2 = decorationVec.offset(0, i, 0)
          //   setBlock(decorationVec2, blocksByName.kelp_plant)
          // }
          // const decorationVec2 = decorationVec.offset(0, height - 1, 0)
          // setBlock(decorationVec2, blocksByName.kelp)
        } else if ((biome === 'plains' && placements(3000) === 0) || (biome === 'forest' && placements(200) === 0)) { // Trees
          const height = placements(4) + 4
          for (let i = 0; i < height; i++) {
            const decorationVec2 = decorationVec.offset(0, i, 0)
            setBlock(decorationVec2, blocksByName.oak_log)
            if (theFlattening) chunk.setBlockData(decorationVec2, 1)
          }
          const topOfTree = decorationVec.offset(0, height, 0)
          const offsets = [
            [0, 0, 0],
            [1, 0, 0],
            [-1, 0, 0],
            [0, 0, 1],
            [0, 0, -1],
            [1, -1, 0],
            [-1, -1, 0],
            [0, -1, 1],
            [0, -1, -1],
            [1, -1, 1],
            [-1, -1, 1],
            [1, -1, -1],
            [-1, -1, -1]
          ]
          for (const [offsetX, offsetY, offsetZ] of offsets) {
            setBlock(topOfTree.offset(offsetX, offsetY, offsetZ), blocksByName.oak_leaves)
          }
          for (let i = height - 3; i < height - 1; i++) {
            for (let dx = -2; dx <= 2; dx++) {
              for (let dz = -2; dz <= 2; dz++) {
                if (dx === 0 && dz === 0) continue
                setBlock(decorationVec.offset(dx, i, dz), blocksByName.oak_leaves)
              }
            }
          }
        }
      }
    }
    return chunk
  }
  return generateSimpleChunk
}

module.exports = generation
