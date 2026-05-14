import { expect } from 'chai'
import { ethers } from 'hardhat'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'

describe('Multicall', async () => {
  let wallets: HardhatEthersSigner[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let multicall: any

  before('get wallets', async () => {
    wallets = await ethers.getSigners()
  })

  beforeEach('create multicall', async () => {
    const multicallTestFactory = await ethers.getContractFactory('TestMulticall')
    multicall = await multicallTestFactory.deploy()
  })

  it('revert messages are returned', async () => {
    await expect(
      multicall.multicall([multicall.interface.encodeFunctionData('functionThatRevertsWithError', ['abcdef'])])
    ).to.be.revertedWith('abcdef')
  })

  it('return data is properly encoded', async () => {
    const [data] = await multicall.multicall.staticCall([
      multicall.interface.encodeFunctionData('functionThatReturnsTuple', ['1', '2']),
    ])
    const {
      tuple: { a, b },
    } = multicall.interface.decodeFunctionResult('functionThatReturnsTuple', data)
    expect(b).to.eq(1)
    expect(a).to.eq(2)
  })

  describe('context is preserved', () => {
    it('msg.value', async () => {
      await multicall.multicall([multicall.interface.encodeFunctionData('pays')], { value: 3 })
      expect(await multicall.paid()).to.eq(3)
    })

    it('msg.value used twice', async () => {
      await multicall.multicall(
        [multicall.interface.encodeFunctionData('pays'), multicall.interface.encodeFunctionData('pays')],
        { value: 3 }
      )
      expect(await multicall.paid()).to.eq(6)
    })

    it('msg.sender', async () => {
      expect(await multicall.returnSender()).to.eq(wallets[0].address)
    })
  })
})
