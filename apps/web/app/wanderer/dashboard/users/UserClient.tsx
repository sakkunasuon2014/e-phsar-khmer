"use client";

import { useMemo, useState } from "react";
import { Eye, Trash2, BadgeCheck, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getAdminUsers, type AdminUsersResult } from "@/actions/admin-users";
import { deleteUser } from "@/actions/user";
import { User } from "@/types/user";
import { AdminPage } from "@/components/dashboard/admin-page";
import {
  AdminSearch,
  AdminTable,
  DateCell,
  PrimaryCell,
  RowActions,
  formatCount,
  type AdminColumn,
} from "@/components/dashboard/admin-table";

/** Stored numbers are already E.164 ("+855…"); the old `+{phone}` produced "++855…". */
function formatPhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function AccountTypeBadge({ type }: { type: User["accountType"] }) {
  if (type === "Premium") {
    return (
      <Badge variant="outline">
        <BadgeCheck className="text-blue-500" />
        Premium
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <UserRound className="text-slate-500" />
      <p className="text-slate-500">Normal</p>
    </Badge>
  );
}

export default function UserPage({
  initialData,
}: {
  initialData?: AdminUsersResult;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => getAdminUsers(),
    initialData,
  });
  const users = data?.users;

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState("all");

  const router = useRouter();
  const locale = useLocale();

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => deleteUser({ userId }),
    onSuccess: (res) => {
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
        toast.success("User deleted");
      } else {
        toast.error(res.error ?? "Failed to delete user");
      }
    },
    onError: () => toast.error("Failed to delete user"),
    onSettled: () => {
      setIsDeleteDialogOpen(false);
      setSelectedUser(null);
    },
  });

  // The adapter asks the API for role=user; the guard stays as a belt-and-braces
  // filter so a staff row can never appear in a customer table.
  const customerUsers = useMemo(
    () =>
      (users ?? []).filter(
        (user) => user.role !== "admin" && user.role !== "super_admin",
      ),
    [users],
  );
  const premiumCount = customerUsers.filter(
    (user) => user.accountType === "Premium",
  ).length;
  const normalCount = customerUsers.filter(
    (user) => user.accountType === "Normal",
  ).length;

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return customerUsers.filter((user) => {
      if (tab === "premium" && user.accountType !== "Premium") return false;
      if (tab === "normal" && user.accountType !== "Normal") return false;
      if (!query) return true;
      return [
        user.userId,
        user.name,
        user.username,
        user.email,
        user.accountType,
        user.role,
        ...user.networks.map(formatPhone),
        ...user.networks,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [customerUsers, searchQuery, tab]);

  const columns = useMemo<AdminColumn<User>[]>(
    () => [
      {
        key: "user",
        header: "User",
        sortValue: (user) => user.name,
        cell: (user) => (
          <PrimaryCell
            shape="round"
            image={user.profileImage}
            alt={user.name}
            title={user.name}
            subtitle={user.email || "No email"}
          />
        ),
      },
      {
        key: "username",
        header: "Username",
        sortValue: (user) => user.username,
        cell: (user) =>
          user.username ? (
            <span className="text-muted-foreground">@{user.username}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "phone",
        header: "Phone",
        sortValue: (user) => formatPhone(user.networks[0] ?? ""),
        cell: (user) => {
          const phones = user.networks
            .filter((value) => value !== "")
            .map(formatPhone);
          if (phones.length === 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-col gap-0.5">
              <span>{phones[0]}</span>
              {phones.length > 1 ? (
                <span
                  className="type-meta text-muted-foreground"
                  title={phones.slice(1).join(", ")}
                >
                  +{phones.length - 1} more
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        key: "verified",
        header: "Verified",
        sortValue: (user) => (user.isVerified ? 1 : 0),
        cell: (user) => (
          <Badge variant="outline">
            <span
              className={`size-1.5 rounded-full ${
                user.isVerified ? "bg-emerald-500" : "bg-rose-500"
              }`}
            />
            {user.isVerified ? "Yes" : "No"}
          </Badge>
        ),
      },
      {
        key: "accountType",
        header: "Account",
        sortValue: (user) => user.accountType,
        cell: (user) => <AccountTypeBadge type={user.accountType} />,
      },
      {
        key: "joined",
        header: "Joined",
        sortValue: (user) => user.createdAt,
        cell: (user) => <DateCell value={user.createdAt} />,
      },
      {
        key: "action",
        header: "Action",
        align: "center",
        cell: (user) => (
          <RowActions
            id={user.userId}
            actions={[
              {
                label: "View",
                icon: <Eye className="mr-2 size-4" />,
                onSelect: () => {
                  if (!user.username) {
                    toast.error("This account has no username yet");
                    return;
                  }
                  router.push(`/${locale}/${user.username}`);
                },
              },
              {
                label: "Delete",
                icon: <Trash2 className="mr-2 size-4" />,
                tone: "danger",
                onSelect: () => {
                  setSelectedUser(user);
                  setIsDeleteDialogOpen(true);
                },
              },
            ]}
          />
        ),
      },
    ],
    [locale, router],
  );

  const handleDelete = () => {
    if (!selectedUser) return;
    deleteMutation.mutate(selectedUser.userId);
  };

  return (
    <>
      <AdminPage
        title="Users"
        description="Manage your users and accounts"
        toolbar={
          <AdminSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search name, username, email, phone, ID..."
          />
        }
      >
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all" className="cursor-pointer">
              All Users
            </TabsTrigger>
            <TabsTrigger value="premium" className="cursor-pointer">
              Premium
              <Badge className="ml-1.5 bg-blue-500 type-meta text-white">
                {formatCount(premiumCount)}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="normal" className="cursor-pointer">
              Normal
              <Badge className="ml-1.5 bg-slate-500 type-meta text-white">
                {formatCount(normalCount)}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <AdminTable
          columns={columns}
          rows={filteredUsers}
          rowKey={(user) => user.userId}
          isLoading={isLoading}
          pageSize={20}
          resetKey={`${searchQuery}:${tab}`}
          emptyTitle="No users found"
          emptyHint={
            searchQuery ? `No results for "${searchQuery}"` : undefined
          }
        />
      </AdminPage>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete User{" "}
              <span className="font-semibold text-red-500">
                {selectedUser?.name}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end gap-2">
            <Button
              className="h-9 rounded-sm cursor-pointer"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="h-9 text-white bg-red-500 rounded-sm hover:bg-red-600 hover:text-white cursor-pointer"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
