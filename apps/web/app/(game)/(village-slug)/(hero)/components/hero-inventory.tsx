import { useMutation } from '@tanstack/react-query';
import { use } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { getItemDefinition } from '@pillage-first/game-assets/utils/items';
import type { heroLoadoutSlotSchema } from '@pillage-first/types/models/hero-loadout';
import { formatNumber } from '@pillage-first/utils/format';
import { ItemTooltip } from 'app/(game)/(village-slug)/(hero)/components/item-tooltip';
import {
  OverflowContainer,
  Section,
  SectionContent,
} from 'app/(game)/(village-slug)/components/building-layout';
import { useHeroInventory } from 'app/(game)/(village-slug)/hooks/use-hero-inventory';
import { useHeroLoadout } from 'app/(game)/(village-slug)/hooks/use-hero-loadout';
import { useMe } from 'app/(game)/(village-slug)/hooks/use-me';
import { InformationPopover } from 'app/(game)/components/information-popover';
import {
  currentVillageCacheKey,
  heroCacheKey,
  heroInventoryCacheKey,
  heroLoadoutCacheKey,
} from 'app/(game)/constants/query-keys';
import { ApiContext } from 'app/(game)/providers/api-context';
import { Text } from 'app/components/text';
import { Button } from 'app/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from 'app/components/ui/table';
import { invalidateQueries } from 'app/utils/react-query';

type HeroLoadoutSlot = z.infer<typeof heroLoadoutSlotSchema>;

// Consumables the hero uses directly, rather than equipping them
const USABLE_ITEM_IDS = new Set([1021, 1022, 1030]);

const heroCacheKeys = [
  [heroCacheKey],
  [heroInventoryCacheKey],
  [heroLoadoutCacheKey],
  [currentVillageCacheKey],
];

const useHeroItemActions = () => {
  const { t } = useTranslation();
  const { apiClient } = use(ApiContext);
  const { player } = useMe();

  const onError = (error: Error) => {
    toast.error(error.message);
  };

  const { mutate: equipItem, isPending: isEquipping } = useMutation<
    void,
    Error,
    { itemId: number; slot: HeroLoadoutSlot; amount: number }
  >({
    mutationFn: async (body) => {
      await apiClient.patch('/players/:playerId/hero/equipped-items', {
        path: { playerId: player.id },
        body,
      });
    },
    onSuccess: async (_data, _variables, _onMutateResult, context) => {
      await invalidateQueries(context, heroCacheKeys);
      toast.success(t('Item equipped'));
    },
    onError,
  });

  const { mutate: unequipItem, isPending: isUnequipping } = useMutation<
    void,
    Error,
    HeroLoadoutSlot
  >({
    mutationFn: async (slot) => {
      await apiClient.delete('/players/:playerId/hero/equipped-items/:slot', {
        path: { playerId: player.id, slot },
      });
    },
    onSuccess: async (_data, _variables, _onMutateResult, context) => {
      await invalidateQueries(context, heroCacheKeys);
      toast.success(t('Item unequipped'));
    },
    onError,
  });

  const { mutate: useItem, isPending: isUsing } = useMutation<
    void,
    Error,
    { itemId: number; amount: number }
  >({
    mutationFn: async (body) => {
      await apiClient.post('/players/:playerId/hero/item', {
        path: { playerId: player.id },
        body,
      });
    },
    onSuccess: async (_data, _variables, _onMutateResult, context) => {
      await invalidateQueries(context, heroCacheKeys);
      toast.success(t('Item used'));
    },
    onError,
  });

  return {
    equipItem,
    unequipItem,
    useItem,
    isPending: isEquipping || isUnequipping || isUsing,
  };
};

export const HeroInventory = () => {
  const { t } = useTranslation();
  const { heroInventory } = useHeroInventory();
  const { heroLoadout } = useHeroLoadout();
  const { equipItem, unequipItem, useItem, isPending } = useHeroItemActions();

  return (
    <Section>
      <SectionContent>
        <InformationPopover ariaLabel={t('Inventory')}>
          <Text>
            {t(
              "Your hero's equipment will give you advantages that will help you outperform your opponents. You may change your hero's equipment whenever your hero is not travelling. Items that affect villages or buildings apply to the village the hero is currently assigned to.",
            )}
          </Text>
        </InformationPopover>
        <Text as="h2">{t('Inventory')}</Text>
      </SectionContent>
      <SectionContent>
        <Text as="h3">{t('Equipped items')}</Text>
        {heroLoadout.length === 0 ? (
          <Text>{t('Your hero has nothing equipped.')}</Text>
        ) : (
          <OverflowContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{t('Item')}</TableHeaderCell>
                  <TableHeaderCell>{t('Amount')}</TableHeaderCell>
                  <TableHeaderCell>{t('Actions')}</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {heroLoadout.map(({ itemId, slot, amount }) => {
                  const item = getItemDefinition(itemId);

                  return (
                    <TableRow key={slot}>
                      <TableCell>
                        <ItemTooltip item={item}>
                          {t(`ITEMS.${item.name}.NAME`)}
                        </ItemTooltip>
                      </TableCell>
                      <TableCell>{formatNumber(amount)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => unequipItem(slot)}
                        >
                          {t('Unequip')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </OverflowContainer>
        )}
      </SectionContent>
      <SectionContent>
        <Text as="h3">{t('Items')}</Text>
        {heroInventory.length === 0 ? (
          <Text>
            {t(
              'Your inventory is empty. Adventures and auctions are good places to find items.',
            )}
          </Text>
        ) : (
          <OverflowContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{t('Item')}</TableHeaderCell>
                  <TableHeaderCell>{t('Amount')}</TableHeaderCell>
                  <TableHeaderCell>{t('Actions')}</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {heroInventory.map(({ id, amount }) => {
                  const item = getItemDefinition(id);
                  const isEquipable = item.slot !== 'non-equipable';
                  const isUsable = USABLE_ITEM_IDS.has(id);

                  return (
                    <TableRow key={id}>
                      <TableCell>
                        <ItemTooltip item={item}>
                          {t(`ITEMS.${item.name}.NAME`, { count: amount })}
                        </ItemTooltip>
                      </TableCell>
                      <TableCell>{formatNumber(amount)}</TableCell>
                      <TableCell>
                        {isEquipable && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() =>
                              equipItem({
                                itemId: id,
                                slot: item.slot as HeroLoadoutSlot,
                                // Stackable items like cages are equipped all at once
                                amount: item.slot === 'consumable' ? amount : 1,
                              })
                            }
                          >
                            {t('Equip')}
                          </Button>
                        )}
                        {isUsable && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => useItem({ itemId: id, amount: 1 })}
                          >
                            {t('Use')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </OverflowContainer>
        )}
      </SectionContent>
    </Section>
  );
};
