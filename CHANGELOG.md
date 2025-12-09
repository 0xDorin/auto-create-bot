# Token Create Bot - 변경 이력

## 2025-12-08 주요 수정사항

### 1. 토큰 주소 획득 방식 변경
**문제**: 트랜잭션 receipt의 로그를 파싱해서 토큰 주소를 추출하는 과정에서 잘못된 주소(라우터 주소)를 사용하는 버그 발생

**해결**: Salt API 응답에서 토큰 주소를 직접 받아서 사용
- `getSalt()` → `getSaltAndAddress()`로 변경
- API 응답 형식: `{ salt: "0x...", address: "0x..." }`
- 토큰 생성 전에 미리 주소를 알 수 있어서 로그 파싱 불필요

**변경된 파일**:
- `src/services/contracts.ts`
  - `getSaltAndAddress()` 함수로 salt와 address 동시 반환
  - `createToken()` 함수에서 API 응답의 address 직접 사용
  - Receipt 로그 파싱 로직 제거

### 2. Pool Address 제거
**이유**: Bonding curve에서만 거래하므로 pool address 불필요

**변경된 파일**:
- `src/services/contracts.ts`
  - `createToken()` 반환 타입에서 `poolAddress` 제거
  - Pool address 파싱 로직 완전 제거

- `src/services/storage.ts`
  - `BotState` 인터페이스에서 `poolAddress` 필드 제거

- `src/services/tokenCreator.ts`
  - `executeTokenCreation()`에서 poolAddress 디스트럭처링 제거
  - State 저장 시 poolAddress 제거

### 3. BalanceOf 호출 안정성 개선
**문제**: Transaction receipt를 받았는데도 `balanceOf` 호출이 실패하는 경우 발생

**원인**: RPC 노드의 상태 동기화 지연

**해결**:
1. Receipt 후 2초 대기 추가 (RPC 노드 동기화 대기)
2. `balanceOf` 호출에 재시도 로직 추가 (최대 3회, 각 2초 간격)
3. 재시도 중 경고 메시지 출력

**변경된 코드** (`src/services/contracts.ts`):
```typescript
// Wait for receipt
const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash });

if (receipt.status === "reverted") {
  throw new Error(`Token creation reverted: ${hash}`);
}

// Wait a bit for contract state to be fully synced on RPC node
await new Promise((resolve) => setTimeout(resolve, 2000));

// Get token balance with retry
let tokensReceived: bigint = 0n;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    tokensReceived = await wallet.publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet.address],
    });
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    console.log(`  ⚠️  balanceOf failed (attempt ${attempt}/3), retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
```

### 4. 설정 변경
**.env 파일**:
- `INITIAL_BUY_AMOUNT`: `0.1` → `10` MON (초기 구매량 증가)
- RPC URL은 `https://monad-testnet.drpc.org` 사용 중

---

## 이전 세션에서 완료된 작업들

### RPC Timeout 개선
- `src/services/wallet.ts`에 60초 timeout 추가
- 여러 RPC 엔드포인트 테스트 후 drpc.org 선택

### Withdrawal Script 개선
- `src/scripts/withdraw-funds.ts` 생성
- 병렬 처리로 성능 향상
- 동적 가스 계산 (고정 21000 gas × gas price)
- 가스비 남기고 잔액 전송

### Metadata 저장 형식 개선
- `src/services/storage.ts`
  - `total_count` 필드 추가 (가시성 향상)
  - 하위 호환성 유지 (배열 형식도 읽기 가능)

### 코드 정리
- 모든 스크립트에서 deprecated 함수 제거
- viem 직접 호출로 통일

---

## 주요 배운 점

### 1. 블록체인 상태 동기화
트랜잭션이 블록에 포함되어도(receipt 수신) RPC 노드의 상태 반영까지 지연이 있을 수 있음
→ **해결**: 대기 시간 + 재시도 로직

### 2. 토큰 주소 결정론적 계산
CREATE2를 사용하면 배포 전에 주소를 미리 계산 가능
→ **활용**: API에서 salt와 함께 address를 미리 받아서 사용

### 3. Node.js 병렬 처리
Node.js는 싱글 스레드지만 I/O 작업(네트워크, 파일)은 비동기로 병렬 처리 가능
→ **활용**: Promise.allSettled()로 여러 지갑 동시 처리

---

## 현재 상태
- ✅ 토큰 생성 안정적으로 작동
- ✅ 자동 판매 기능 정상 작동
- ✅ State 저장/복원 정상
- ✅ RPC timeout 이슈 해결
- ✅ BalanceOf 조회 안정성 확보
