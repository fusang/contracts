import { expect } from 'chai'
import { ethers } from 'hardhat'
import { base64Encode } from '../shared/base64'
import { randomBytes } from 'crypto'

function stringToHex(str: string): string {
  return `0x${Buffer.from(str, 'utf8').toString('hex')}`
}

describe('Base64', () => {
  let base64: any

  before('deploy test contract', async () => {
    base64 = await (await ethers.getContractFactory('Base64Test')).deploy()
  })

  describe('#encode', () => {
    it('is correct for empty bytes', async () => {
      expect(await base64.encode(stringToHex(''))).to.eq('')
    })

    for (const example of [
      'test string',
      'this is a test',
      'alphabet soup',
      'aLpHaBeT',
      'includes\nnewlines',
      '<some html>',
      '😀',
      'f',
      'fo',
      'foo',
      'foob',
      'fooba',
      'foobar',
      'this is a very long string that should cost a lot of gas to encode :)',
    ]) {
      it(`works for "${example}"`, async () => {
        expect(await base64.encode(stringToHex(example))).to.eq(base64Encode(example))
      })
    }

    describe('max size string (24kB)', () => {
      let str: string
      before(() => {
        str = Array<null>(24 * 1024)
          .fill(null)
          .map((_, i) => String.fromCharCode(i % 1024))
          .join('')
      })
      it('correctness', async () => {
        expect(await base64.encode(stringToHex(str))).to.eq(base64Encode(str))
      })
    })

    it('tiny fuzzing', async () => {
      const inputs = []
      for (let i = 0; i < 100; i++) {
        inputs.push(randomBytes(Math.random() * 100))
      }

      const promises = inputs.map((input) => {
        return base64.encode(`0x${input.toString('hex')}`)
      })

      const results = await Promise.all(promises)

      for (let i = 0; i < inputs.length; i++) {
        expect(inputs[i].toString('base64')).to.eq(results[i])
      }
    }).timeout(300_000)
  })
})
