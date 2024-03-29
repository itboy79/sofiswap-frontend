import React, { useEffect, useState, useMemo, useCallback } from 'react'
import styled from 'styled-components'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'
import {
  Modal,
  Text,
  Flex,
  HelpIcon,
  BalanceInput,
  Ticket,
  useTooltip,
  Skeleton,
  Button,
  ArrowForwardIcon,
} from '@pancakeswap/uikit'
import { useTranslation } from 'contexts/Localization'
import { useWeb3React } from '@web3-react/core'
import { getFullDisplayBalance } from 'utils/formatBalance'
import { getCakeAddress } from 'utils/addressHelpers'
import { BIG_ZERO, ethersToBigNumber } from 'utils/bigNumber'
import { useAppDispatch } from 'state'
import { usePriceCakeBusd, useLottery } from 'state/hooks'
import { fetchUserTicketsAndLotteries } from 'state/lottery'
import useTheme from 'hooks/useTheme'
import useTokenBalance, { FetchStatus } from 'hooks/useTokenBalance'
import useApproveConfirmTransaction from 'hooks/useApproveConfirmTransaction'
import { useCake, useLotteryV2Contract } from 'hooks/useContract'
import useToast from 'hooks/useToast'
import UnlockButton from 'components/UnlockButton'
import ApproveConfirmButtons, { ButtonArrangement } from 'views/Profile/components/ApproveConfirmButtons'
import NumTicketsToBuyButton from './NumTicketsToBuyButton'
import EditNumbersModal from './EditNumbersModal'
import { useTicketsReducer } from './useTicketsReducer'

const StyledModal = styled(Modal)`
  min-width: 280px;
  max-width: 320px;
`

interface BuyTicketsModalProps {
  onDismiss?: () => void
}

enum BuyingStage {
  BUY = 'Buy',
  EDIT = 'Edit',
}

const BuyTicketsModal: React.FC<BuyTicketsModalProps> = ({ onDismiss }) => {
  const { account } = useWeb3React()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const {
    maxNumberTicketsPerBuyOrClaim,
    currentLotteryId,
    currentRound: {
      priceTicketInCake,
      discountDivisor,
      userTickets: { tickets: userCurrentTickets },
    },
  } = useLottery()
  const [ticketsToBuy, setTicketsToBuy] = useState('0')
  const [discountValue, setDiscountValue] = useState('')
  const [totalCost, setTotalCost] = useState('')
  const [ticketCostBeforeDiscount, setTicketCostBeforeDiscount] = useState('')
  const [buyingStage, setBuyingStage] = useState<BuyingStage>(BuyingStage.BUY)
  const [maxPossibleTicketPurchase, setMaxPossibleTicketPurchase] = useState(BIG_ZERO)
  const [maxTicketPurchaseExceeded, setMaxTicketPurchaseExceeded] = useState(false)
  const [userNotEnoughCake, setUserNotEnoughCake] = useState(false)
  const lotteryContract = useLotteryV2Contract()
  const cakeContract = useCake()
  const { toastSuccess } = useToast()
  const { balance: userCake, fetchStatus } = useTokenBalance(getCakeAddress())
  // balance from useTokenBalance causes rerenders in effects as a new BigNumber is instanciated on each render, hence memoising it using the stringified value below.
  const stringifiedUserCake = userCake.toJSON()
  const memoisedUserCake = useMemo(() => new BigNumber(stringifiedUserCake), [stringifiedUserCake])

  const cakePriceBusd = usePriceCakeBusd()
  const dispatch = useAppDispatch()
  const hasFetchedBalance = fetchStatus === FetchStatus.SUCCESS
  const userCakeDisplayBalance = getFullDisplayBalance(userCake, 18, 3)

  const TooltipComponent = () => (
    <>
      <Text mb="16px">
        {t(
          'Buying multiple tickets in a single transaction gives a discount. The discount increases in a linear way, up to the maximum of 100 tickets:',
        )}
      </Text>
      <Text>{t('2 tickets: 0.05%')}</Text>
      <Text>{t('50 tickets: 2.45%')}</Text>
      <Text>{t('100 tickets: 4.95%')}</Text>
    </>
  )
  const { targetRef, tooltip, tooltipVisible } = useTooltip(<TooltipComponent />, {
    placement: 'bottom-end',
    tooltipOffset: [20, 10],
  })

  const limitNumberByMaxTicketsPerBuy = useCallback(
    (number: BigNumber) => {
      return number.gt(maxNumberTicketsPerBuyOrClaim) ? maxNumberTicketsPerBuyOrClaim : number
    },
    [maxNumberTicketsPerBuyOrClaim],
  )

  useEffect(() => {
    const getMaxPossiblePurchase = () => {
      const maxBalancePurchase = memoisedUserCake.div(priceTicketInCake)
      const maxPurchase = limitNumberByMaxTicketsPerBuy(maxBalancePurchase)
      if (hasFetchedBalance && maxPurchase.eq(0)) {
        setUserNotEnoughCake(true)
      } else {
        setUserNotEnoughCake(false)
      }
      setMaxPossibleTicketPurchase(maxPurchase)
    }
    getMaxPossiblePurchase()
  }, [
    maxNumberTicketsPerBuyOrClaim,
    priceTicketInCake,
    memoisedUserCake,
    limitNumberByMaxTicketsPerBuy,
    hasFetchedBalance,
  ])

  useEffect(() => {
    const numberOfTicketsToBuy = new BigNumber(ticketsToBuy)
    const getCostAfterDiscount = () => {
      const totalAfterDiscount = priceTicketInCake
        .times(numberOfTicketsToBuy)
        .times(discountDivisor.plus(1).minus(numberOfTicketsToBuy))
        .div(discountDivisor)
      return totalAfterDiscount
    }
    const costAfterDiscount = getCostAfterDiscount()
    const costBeforeDiscount = priceTicketInCake.times(numberOfTicketsToBuy)
    const discountBeingApplied = costBeforeDiscount.minus(costAfterDiscount)

    setTicketCostBeforeDiscount(costBeforeDiscount.gt(0) ? getFullDisplayBalance(costBeforeDiscount) : '0')
    setTotalCost(costAfterDiscount.gt(0) ? getFullDisplayBalance(costAfterDiscount) : '0')
    setDiscountValue(discountBeingApplied.gt(0) ? getFullDisplayBalance(discountBeingApplied, 18, 5) : '0')
  }, [ticketsToBuy, priceTicketInCake, discountDivisor])

  const getNumTicketsByPercentage = (percentage: number): number => {
    const percentageOfMaxTickets = maxPossibleTicketPurchase.gt(0)
      ? maxPossibleTicketPurchase.div(new BigNumber(100)).times(new BigNumber(percentage))
      : BIG_ZERO
    return Math.floor(percentageOfMaxTickets.toNumber())
  }

  const tenPercentOfBalance = getNumTicketsByPercentage(10)
  const twentyFivePercentOfBalance = getNumTicketsByPercentage(25)
  const fiftyPercentOfBalance = getNumTicketsByPercentage(50)
  const oneHundredPercentOfBalance = getNumTicketsByPercentage(100)

  const getCakeValueOfTickets = (numberOfTickets: BigNumber): BigNumber => {
    const totalTicketsCakeValue = priceTicketInCake.times(numberOfTickets)
    return totalTicketsCakeValue
  }

  const handleInputChange = (input: string) => {
    // Force input to integer
    const inputAsInt = parseInt(input, 10)
    const inputAsBN = new BigNumber(inputAsInt)
    const limitedNumberTickets = limitNumberByMaxTicketsPerBuy(inputAsBN)
    const cakeValueOfInput = getCakeValueOfTickets(limitedNumberTickets)

    if (cakeValueOfInput.gt(userCake)) {
      setUserNotEnoughCake(true)
    } else if (limitedNumberTickets.eq(maxPossibleTicketPurchase)) {
      setMaxTicketPurchaseExceeded(true)
    } else {
      setUserNotEnoughCake(false)
      setMaxTicketPurchaseExceeded(false)
    }
    setTicketsToBuy(inputAsInt ? limitedNumberTickets.toString() : '0')
  }

  const handleNumberButtonClick = (number: number) => {
    setTicketsToBuy(number.toFixed())
    setUserNotEnoughCake(false)
    setMaxTicketPurchaseExceeded(false)
  }

  const [updateTicket, randomize, tickets, allComplete, getTicketsForPurchase] = useTicketsReducer(
    parseInt(ticketsToBuy, 10),
    userCurrentTickets,
  )

  const { isApproving, isApproved, isConfirmed, isConfirming, handleApprove, handleConfirm } =
    useApproveConfirmTransaction({
      onRequiresApproval: async () => {
        try {
          const response = await cakeContract.allowance(account, lotteryContract.address)
          const currentAllowance = ethersToBigNumber(response)
          return currentAllowance.gt(0)
        } catch (error) {
          return false
        }
      },
      onApprove: () => {
        return cakeContract.approve(lotteryContract.address, ethers.constants.MaxUint256)
      },
      onApproveSuccess: async () => {
        toastSuccess(t('Contract approved - you can now purchase tickets'))
      },
      onConfirm: () => {
        const ticketsForPurchase = getTicketsForPurchase()
        return lotteryContract.buyTickets(currentLotteryId, ticketsForPurchase)
      },
      onSuccess: async () => {
        onDismiss()
        dispatch(fetchUserTicketsAndLotteries({ account, lotteryId: currentLotteryId }))
        toastSuccess(t('Lottery tickets purchased!'))
      },
    })

  const getErrorMessage = () => {
    if (userNotEnoughCake) return t('Insufficient CAKE balance')
    return t('The maximum number of tickets you can buy in one transaction is %maxTickets%', {
      maxTickets: maxPossibleTicketPurchase.toString(),
    })
  }

  const costInCake = () => getFullDisplayBalance(priceTicketInCake.times(ticketsToBuy))
  const percentageDiscount = () => {
    const percentageAsBn = new BigNumber(discountValue).div(new BigNumber(ticketCostBeforeDiscount)).times(100)
    if (percentageAsBn.isNaN() || percentageAsBn.eq(0)) {
      return 0
    }
    return percentageAsBn.toNumber().toFixed(2)
  }

  const disableBuying =
    !isApproved ||
    isConfirmed ||
    userNotEnoughCake ||
    !ticketsToBuy ||
    new BigNumber(ticketsToBuy).lte(0) ||
    getTicketsForPurchase().length !== parseInt(ticketsToBuy, 10)

  if (buyingStage === BuyingStage.EDIT) {
    return (
      <EditNumbersModal
        totalCost={totalCost}
        updateTicket={updateTicket}
        randomize={randomize}
        tickets={tickets}
        allComplete={allComplete}
        onConfirm={handleConfirm}
        isConfirming={isConfirming}
        onDismiss={() => setBuyingStage(BuyingStage.BUY)}
      />
    )
  }

  return (
    <StyledModal title={t('Buy Tickets')} onDismiss={onDismiss} headerBackground={theme.colors.gradients.cardHeader}>
      {tooltipVisible && tooltip}
      <Flex alignItems="center" justifyContent="space-between" mb="8px">
        <Text color="textSubtle">{t('Buy')}:</Text>
        <Flex alignItems="center" minWidth="70px">
          <Text mr="4px" bold>
            {t('Tickets')}
          </Text>
          <Ticket />
        </Flex>
      </Flex>
      <BalanceInput
        isWarning={userNotEnoughCake || maxTicketPurchaseExceeded}
        value={ticketsToBuy}
        onUserInput={handleInputChange}
        currencyValue={
          cakePriceBusd.gt(0) &&
          `~${ticketsToBuy ? getFullDisplayBalance(getCakeValueOfTickets(new BigNumber(ticketsToBuy))) : '0.00'} CAKE`
        }
      />
      <Flex alignItems="center" justifyContent="flex-end" mt="4px" mb="12px">
        <Flex justifyContent="flex-end" flexDirection="column">
          {(userNotEnoughCake || maxTicketPurchaseExceeded) && (
            <Text fontSize="12px" color="failure">
              {getErrorMessage()}
            </Text>
          )}
          <Flex justifyContent="flex-end">
            <Text fontSize="12px" color="textSubtle" mr="4px">
              CAKE {t('Balance')}:
            </Text>
            {hasFetchedBalance ? (
              <Text fontSize="12px" color="textSubtle">
                {userCakeDisplayBalance}
              </Text>
            ) : (
              <Skeleton width={50} height={12} />
            )}
          </Flex>
        </Flex>
      </Flex>

      <Flex alignItems="center" justifyContent="space-between" mt="8px" mb="24px">
        <NumTicketsToBuyButton
          disabled={!hasFetchedBalance || tenPercentOfBalance < 1}
          onClick={() => handleNumberButtonClick(tenPercentOfBalance)}
        >
          {hasFetchedBalance ? tenPercentOfBalance : ``}
        </NumTicketsToBuyButton>
        <NumTicketsToBuyButton
          disabled={!hasFetchedBalance || twentyFivePercentOfBalance < 1}
          onClick={() => handleNumberButtonClick(twentyFivePercentOfBalance)}
        >
          {hasFetchedBalance ? twentyFivePercentOfBalance : ``}
        </NumTicketsToBuyButton>
        <NumTicketsToBuyButton
          disabled={!hasFetchedBalance || fiftyPercentOfBalance < 1}
          onClick={() => handleNumberButtonClick(fiftyPercentOfBalance)}
        >
          {hasFetchedBalance ? fiftyPercentOfBalance : ``}
        </NumTicketsToBuyButton>
        <NumTicketsToBuyButton
          disabled={!hasFetchedBalance || oneHundredPercentOfBalance < 1}
          onClick={() => handleNumberButtonClick(oneHundredPercentOfBalance)}
        >
          MAX
        </NumTicketsToBuyButton>
      </Flex>

      <Flex flexDirection="column">
        <Flex mb="8px" justifyContent="space-between">
          <Text color="textSubtle" fontSize="14px">
            {t('Cost')} (CAKE)
          </Text>
          <Text color="textSubtle" fontSize="14px">
            {priceTicketInCake && costInCake()} CAKE
          </Text>
        </Flex>
        <Flex mb="8px" justifyContent="space-between">
          <Flex>
            <Text display="inline" bold fontSize="14px" mr="4px">
              {discountValue && totalCost ? percentageDiscount() : 0}%
            </Text>
            <Text display="inline" color="textSubtle" fontSize="14px">
              {t('Bulk discount')}
            </Text>
            <Flex alignItems="center" justifyContent="center" ref={targetRef}>
              <HelpIcon ml="4px" width="14px" height="14px" color="textSubtle" />
            </Flex>
          </Flex>
          <Text fontSize="14px" color="textSubtle">
            ~{discountValue} CAKE
          </Text>
        </Flex>
        <Flex borderTop={`1px solid ${theme.colors.cardBorder}`} pt="8px" mb="24px" justifyContent="space-between">
          <Text color="textSubtle" fontSize="16px">
            {t('You pay')}
          </Text>
          <Text fontSize="16px" bold>
            ~{totalCost} CAKE
          </Text>
        </Flex>

        {account ? (
          <>
            <ApproveConfirmButtons
              isApproveDisabled={isApproved}
              isApproving={isApproving}
              isConfirmDisabled={disableBuying}
              isConfirming={isConfirming}
              onApprove={handleApprove}
              onConfirm={handleConfirm}
              buttonArrangement={ButtonArrangement.SEQUENTIAL}
              confirmLabel={t('Buy Instantly')}
            />
            <Button
              id={`lottery_buy_ins_${ticketsToBuy}`}
              variant="secondary"
              mt="8px"
              disabled={disableBuying || isConfirming}
              onClick={() => {
                setBuyingStage(BuyingStage.EDIT)
              }}
            >
              <Flex alignItems="center">
                {t('View/Edit Numbers')}{' '}
                <ArrowForwardIcon
                  mt="2px"
                  color={disableBuying || isConfirming ? 'disabled' : 'primary'}
                  height="24px"
                  width="24px"
                />
              </Flex>
            </Button>
          </>
        ) : (
          <UnlockButton />
        )}

        <Text mt="24px" fontSize="12px" color="textSubtle">
          {t(
            '"Buy Instantly" chooses random numbers, with no duplicates among your tickets. Prices are set before each round starts, equal to $5 at that time. Purchases are final.',
          )}
        </Text>
      </Flex>
    </StyledModal>
  )
}

export default BuyTicketsModal
