import { z } from 'zod';
import {
  heroAuctionBuyListingDtoSchema,
  heroAuctionHistoryEntryDtoSchema,
  heroAuctionSellListingDtoSchema,
} from '@pillage-first/types/dtos/hero';
import { getGameTime } from '../../simulation/game-clock';
import {
  buyHeroAuctionListingById,
  getHeroAuctionBuyListingRows,
  getHeroAuctionHistoryRows,
  getHeroAuctionSellListingRows,
  sellHeroItem,
} from '../../utils/hero-auctions';
import { createController } from '../controller';
import {
  mapHeroAuctionBuyListing,
  mapHeroAuctionHistoryEntry,
  mapHeroAuctionSellListing,
} from './mappers/hero-mapper';

export const getHeroAuctionBuyListings = createController(
  '/players/:playerId/hero/auctions/buy',
  {
    summary: 'Get hero auction buy listings',
    requestParams: {
      path: z.strictObject({
        playerId: z.coerce.number(),
      }),
    },
    response: z.array(heroAuctionBuyListingDtoSchema),
  },
)(({ database, path: { playerId } }) => {
  return getHeroAuctionBuyListingRows(
    database,
    playerId,
    getGameTime(database),
  ).map(mapHeroAuctionBuyListing);
});

export const buyHeroAuctionListing = createController(
  '/players/:playerId/hero/auctions/buy/:listingId',
  'post',
  {
    summary: 'Buy hero auction listing',
    requestParams: {
      path: z.strictObject({
        playerId: z.coerce.number(),
        listingId: z.coerce.number(),
      }),
    },
  },
)(({ database, path: { playerId, listingId } }) => {
  buyHeroAuctionListingById(
    database,
    playerId,
    listingId,
    getGameTime(database),
  );
});

export const getHeroAuctionSellListings = createController(
  '/players/:playerId/hero/auctions/sell',
  {
    summary: 'Get hero auction sell listings',
    requestParams: {
      path: z.strictObject({
        playerId: z.coerce.number(),
      }),
    },
    response: z.array(heroAuctionSellListingDtoSchema),
  },
)(({ database, path: { playerId } }) => {
  return getHeroAuctionSellListingRows(
    database,
    playerId,
    getGameTime(database),
  ).map(mapHeroAuctionSellListing);
});

export const sellHeroAuctionItem = createController(
  '/players/:playerId/hero/auctions/sell',
  'post',
  {
    summary: 'Sell hero item on auction',
    requestParams: {
      path: z.strictObject({
        playerId: z.coerce.number(),
      }),
    },
    requestBody: z.strictObject({
      itemId: z.number(),
      amount: z.number().int().positive(),
      mode: z.enum(['instant', 'auction']),
    }),
  },
)(({ database, path: { playerId }, body: { itemId, amount, mode } }) => {
  sellHeroItem(database, playerId, itemId, amount, mode, getGameTime(database));
});

export const getHeroAuctionHistory = createController(
  '/players/:playerId/hero/auctions/history',
  {
    summary: 'Get hero auction history',
    requestParams: {
      path: z.strictObject({
        playerId: z.coerce.number(),
      }),
    },
    response: z.array(heroAuctionHistoryEntryDtoSchema),
  },
)(({ database, path: { playerId } }) => {
  return getHeroAuctionHistoryRows(
    database,
    playerId,
    getGameTime(database),
  ).map(mapHeroAuctionHistoryEntry);
});
