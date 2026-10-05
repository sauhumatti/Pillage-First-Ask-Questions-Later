import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark } from 'app/(game)/(village-slug)/(village)/(...building-field-id)/components/building-tabs/bookmark';
import {
  TroopMovementFilters,
  type TroopMovementFilterType,
} from 'app/(game)/(village-slug)/(village)/(...building-field-id)/components/building-tabs/rally-point/components/troop-movement-filters';
import { useTroopMovementFilters } from 'app/(game)/(village-slug)/(village)/(...building-field-id)/components/building-tabs/rally-point/hooks/use-troop-movement-filters';
import {
  OverflowContainer,
  Section,
  SectionContent,
} from 'app/(game)/(village-slug)/components/building-layout';
import { Countdown } from 'app/(game)/(village-slug)/components/countdown';
import { partitionTroopMovementEvents } from 'app/(game)/(village-slug)/components/troop-movements';
import { useCurrentVillage } from 'app/(game)/(village-slug)/hooks/current-village/use-current-village';
import { usePagination } from 'app/(game)/(village-slug)/hooks/use-pagination';
import { useVillageTroopMovements } from 'app/(game)/(village-slug)/hooks/use-village-troop-movements';
import { InformationPopover } from 'app/(game)/components/information-popover';
import { Icon } from 'app/components/icon';
import { Text } from 'app/components/text';
import { Pagination } from 'app/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from 'app/components/ui/table';

type TroopMovement = ReturnType<
  typeof useVillageTroopMovements
>['troopMovements'][number];

type CategorizedTroopMovement = {
  category: TroopMovementFilterType;
  movement: TroopMovement;
};

const useMovementTypeLabel = () => {
  const { t } = useTranslation();

  return (type: TroopMovement['type']): string => {
    switch (type) {
      case 'troopMovementAttack':
        return t('Attack');
      case 'troopMovementRaid':
        return t('Raid');
      case 'troopMovementReinforcements':
        return t('Reinforcements');
      case 'troopMovementRelocation':
        return t('Relocation');
      case 'troopMovementReturn':
        return t('Return');
      case 'troopMovementOasisOccupation':
        return t('Oasis occupation');
      case 'troopMovementFindNewVillage':
        return t('Founding a new village');
      case 'troopMovementAdventure':
        return t('Adventure');
    }
  };
};

export const RallyPointTroopMovements = () => {
  const { t } = useTranslation();
  const { currentVillage } = useCurrentVillage();
  const { troopMovements } = useVillageTroopMovements();
  const getMovementTypeLabel = useMovementTypeLabel();
  const {
    filters: troopMovementFilters,
    onFiltersChange: onTroopMovementFiltersChange,
    page,
    handlePageChange,
  } = useTroopMovementFilters();

  const filteredMovements = useMemo(() => {
    const partitioned = partitionTroopMovementEvents(
      troopMovements,
      currentVillage.id,
    );

    const categorized: CategorizedTroopMovement[] = [
      ...partitioned.outgoingDeploymentMovementEvents.map((movement) => ({
        category: 'deploymentOutgoing' as const,
        movement,
      })),
      ...partitioned.incomingDeploymentMovementEvents.map((movement) => ({
        category: 'deploymentIncoming' as const,
        movement,
      })),
      ...partitioned.outgoingOffensiveMovementEvents.map((movement) => ({
        category: 'offensiveMovementOutgoing' as const,
        movement,
      })),
      ...partitioned.incomingOffensiveMovementEvents.map((movement) => ({
        category: 'offensiveMovementIncoming' as const,
        movement,
      })),
      ...partitioned.adventureMovementEvents.map((movement) => ({
        category: 'adventure' as const,
        movement,
      })),
      ...partitioned.findNewVillageMovementEvents.map((movement) => ({
        category: 'findNewVillage' as const,
        movement,
      })),
    ];

    const activeFilters = new Set(troopMovementFilters);

    return categorized
      .filter(({ category }) => activeFilters.has(category))
      .sort((a, b) => a.movement.resolvesAt - b.movement.resolvesAt);
  }, [troopMovements, currentVillage.id, troopMovementFilters]);

  const pagination = usePagination(filteredMovements, 20, page);

  return (
    <Section>
      <SectionContent>
        <Bookmark tab="troop-movements" />
        <InformationPopover ariaLabel={t('Troop movements')}>
          <Text>
            {t(
              'This is a view of troop movements related to this village. You may toggle different types through filters below.',
            )}
          </Text>
        </InformationPopover>
        <Text as="h2">{t('Troop movements')}</Text>
      </SectionContent>
      <SectionContent>
        <TroopMovementFilters
          troopMovementFilters={troopMovementFilters}
          onChange={onTroopMovementFiltersChange}
        />
        {filteredMovements.length === 0 ? (
          <Text>{t('There are no troop movements.')}</Text>
        ) : (
          <OverflowContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{t('Type')}</TableHeaderCell>
                  <TableHeaderCell>{t('From')}</TableHeaderCell>
                  <TableHeaderCell>{t('To')}</TableHeaderCell>
                  <TableHeaderCell>{t('Arrives in')}</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.currentPageItems.map(({ category, movement }) => (
                  <TableRow key={movement.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <Icon
                          type={category}
                          className="size-4"
                        />
                        {getMovementTypeLabel(movement.type)}
                      </span>
                    </TableCell>
                    <TableCell>{movement.originatingVillageName}</TableCell>
                    <TableCell>
                      {'targetVillageName' in movement
                        ? (movement.targetVillageName ?? t('Unoccupied tile'))
                        : t('Adventure')}
                    </TableCell>
                    <TableCell>
                      <Countdown endsAt={movement.resolvesAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </OverflowContainer>
        )}
        <div className="flex w-full justify-end">
          <Pagination
            {...pagination}
            setPage={handlePageChange}
          />
        </div>
      </SectionContent>
    </Section>
  );
};
