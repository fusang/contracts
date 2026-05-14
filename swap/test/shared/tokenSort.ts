// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TokenLike = { target?: string; address?: string } | any

function getAddress(token: TokenLike): string {
  if (typeof token.target === 'string') {
    return token.target
  }
  if (typeof token.address === 'string') {
    return token.address
  }
  throw new Error('Token has no address or target property')
}

export function compareToken(a: TokenLike, b: TokenLike): -1 | 1 {
  return getAddress(a).toLowerCase() < getAddress(b).toLowerCase() ? -1 : 1
}

export function sortedTokens<T extends TokenLike, U extends TokenLike>(
  a: T,
  b: U
): [T, U] | [U, T] {
  return compareToken(a, b) < 0 ? [a, b] : [b, a]
}
